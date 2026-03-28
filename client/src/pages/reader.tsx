import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation, useParams } from "wouter";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Bookmark,
  BookmarkCheck,
  Sun,
  Moon,
  Settings,
  Minus,
  Plus,
  Type,
} from "lucide-react";
import type { Book, Bookmark as BookmarkType } from "@shared/schema";
import ePub from "epubjs";
import type { Rendition, Book as EpubBook, NavItem } from "epubjs";

export default function Reader() {
  const params = useParams<{ id: string }>();
  const bookId = Number(params.id);
  const [, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  const viewerRef = useRef<HTMLDivElement>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const [toc, setToc] = useState<NavItem[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [chapterTitle, setChapterTitle] = useState("");
  const [fontSize, setFontSize] = useState(100);
  const [showUI, setShowUI] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isBookmarkOnPage, setIsBookmarkOnPage] = useState(false);

  const { data: book } = useQuery<Book>({
    queryKey: ["/api/books", bookId],
  });

  const { data: bookmarks = [], refetch: refetchBookmarks } = useQuery<BookmarkType[]>({
    queryKey: ["/api/books", bookId, "bookmarks"],
  });

  const updateProgressMutation = useMutation({
    mutationFn: async (data: { currentCfi: string; progress: number }) => {
      await apiRequest("PATCH", `/api/books/${bookId}`, {
        ...data,
        lastReadAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
    },
  });

  const addBookmarkMutation = useMutation({
    mutationFn: async (data: { cfi: string; label: string; excerpt: string }) => {
      const res = await apiRequest("POST", `/api/books/${bookId}/bookmarks`, data);
      return res.json();
    },
    onSuccess: () => {
      refetchBookmarks();
      toast({ title: "Bookmark added" });
    },
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bookmarks/${id}`);
    },
    onSuccess: () => {
      refetchBookmarks();
      toast({ title: "Bookmark removed" });
    },
  });

  // Initialize EPUB
  useEffect(() => {
    if (!book || !viewerRef.current) return;

    let destroyed = false;

    async function initEpub() {
      if (!viewerRef.current) return;

      // Fetch EPUB as ArrayBuffer for reliable loading
      const response = await fetch(`./api/books/${bookId}/file`);
      const arrayBuffer = await response.arrayBuffer();

      if (destroyed) return;

      const epub = ePub(arrayBuffer);
      epubRef.current = epub;

      const rendition = epub.renderTo(viewerRef.current!, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
      });

      renditionRef.current = rendition;

      // Apply theme
      rendition.themes.default({
        "body, p, span, div, h1, h2, h3, h4, h5, h6, li, a, em, strong, blockquote, figcaption, cite": {
          "color": theme === "dark" ? "#e0ddd8 !important" : "#2a2520 !important",
          "font-size": `${fontSize}% !important`,
        },
        "body": {
          "background-color": theme === "dark" ? "#1a1917 !important" : "#faf9f6 !important",
          "padding": "16px 20px !important",
          "line-height": "1.7 !important",
        },
        "img": {
          "max-width": "100% !important",
          "height": "auto !important",
        },
        "a": {
          "color": theme === "dark" ? "#c9874d !important" : "#b35c1e !important",
        },
      });

      // Display book at saved position or beginning
      const startCfi = book.currentCfi;
      if (startCfi) {
        rendition.display(startCfi);
      } else {
        rendition.display();
      }

      // Load TOC
      epub.loaded.navigation.then((nav) => {
        if (!destroyed) setToc(nav.toc || []);
      });

      // Extract and update metadata if still default
      try {
        await epub.ready;
        const metadata = epub.packaging?.metadata;
        if (metadata && (book.title === book.fileName?.replace(/\.epub$/i, '') || book.author === 'Unknown')) {
          const updateData: Record<string, string> = {};
          if (metadata.title) updateData.title = metadata.title;
          if (metadata.creator) updateData.author = metadata.creator;
          if (Object.keys(updateData).length > 0) {
            await apiRequest("PATCH", `/api/books/${bookId}`, updateData);
            queryClient.invalidateQueries({ queryKey: ["/api/books", bookId] });
          }
        }
      } catch (e) {
        console.log("Metadata extraction failed:", e);
      }

      // Track location changes
      rendition.on("relocated", (location: any) => {
        if (destroyed) return;
        const cfi = location.start.cfi;
        setCurrentCfi(cfi);

        // Calculate progress
        if (epub.locations && (epub.locations as any).total) {
          const currentLocation = epub.locations.percentageFromCfi(cfi);
          const pct = Math.round((currentLocation || 0) * 100);
          setProgress(pct);
          updateProgressMutation.mutate({ currentCfi: cfi, progress: pct });
        }

        // Update chapter title
        if (location.start?.href) {
          const tocItem = findTocItem(toc, location.start.href);
          if (tocItem) setChapterTitle(tocItem.label?.trim() || "");
        }
      });

      // Generate locations for progress tracking
      try {
        await epub.ready;
        await epub.locations.generate(1024);
        if (renditionRef.current && !destroyed) {
          const currentLocation = renditionRef.current.currentLocation() as any;
          if (currentLocation?.start?.cfi) {
            const pct = Math.round((epub.locations.percentageFromCfi(currentLocation.start.cfi) || 0) * 100);
            setProgress(pct);
          }
        }
      } catch (e) {
        console.log("Location generation failed:", e);
      }

      // Keyboard navigation inside iframe
      rendition.on("keydown", (e: KeyboardEvent) => {
        if (e.key === "ArrowLeft") rendition.prev();
        if (e.key === "ArrowRight") rendition.next();
      });
    }

    initEpub().catch(console.error);

    return () => {
      destroyed = true;
      if (renditionRef.current) {
        try { renditionRef.current.destroy(); } catch (e) {}
      }
      if (epubRef.current) {
        try { epubRef.current.destroy(); } catch (e) {}
      }
    };
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme when it changes
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.default({
      "body, p, span, div, h1, h2, h3, h4, h5, h6, li, a, em, strong, blockquote, figcaption, cite": {
        "color": theme === "dark" ? "#e0ddd8 !important" : "#2a2520 !important",
      },
      "body": {
        "background-color": theme === "dark" ? "#1a1917 !important" : "#faf9f6 !important",
      },
      "a": {
        "color": theme === "dark" ? "#c9874d !important" : "#b35c1e !important",
      },
    });
    // Force a re-render of the current page
    const currentLocation = renditionRef.current.currentLocation() as any;
    if (currentLocation?.start?.cfi) {
      renditionRef.current.display(currentLocation.start.cfi);
    }
  }, [theme]);

  // Update font size
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.default({
      "body, p, span, div, h1, h2, h3, h4, h5, h6, li, a, em, strong, blockquote, figcaption, cite": {
        "font-size": `${fontSize}% !important`,
      },
    });
    const currentLocation = renditionRef.current.currentLocation() as any;
    if (currentLocation?.start?.cfi) {
      renditionRef.current.display(currentLocation.start.cfi);
    }
  }, [fontSize]);

  // Check if current page has a bookmark
  useEffect(() => {
    if (currentCfi && bookmarks.length > 0) {
      setIsBookmarkOnPage(bookmarks.some((bm) => bm.cfi === currentCfi));
    } else {
      setIsBookmarkOnPage(false);
    }
  }, [currentCfi, bookmarks]);

  // Keyboard handler for the main document
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") renditionRef.current?.prev();
      if (e.key === "ArrowRight") renditionRef.current?.next();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const goNext = useCallback(() => renditionRef.current?.next(), []);
  const goPrev = useCallback(() => renditionRef.current?.prev(), []);

  const goToChapter = (href: string) => {
    renditionRef.current?.display(href);
    setTocOpen(false);
  };

  const goToBookmark = (cfi: string) => {
    renditionRef.current?.display(cfi);
    setBookmarksOpen(false);
  };

  const toggleBookmark = () => {
    if (!currentCfi) return;
    const existing = bookmarks.find((bm) => bm.cfi === currentCfi);
    if (existing) {
      deleteBookmarkMutation.mutate(existing.id);
    } else {
      addBookmarkMutation.mutate({
        cfi: currentCfi,
        label: chapterTitle || "Bookmark",
        excerpt: "",
      });
    }
  };

  const toggleUIVisibility = () => setShowUI((s) => !s);

  if (!book) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="w-10 h-10 bg-muted rounded-full" />
          <div className="h-3 w-24 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <header
        className={`flex items-center justify-between px-3 py-2 border-b border-border bg-background/95 backdrop-blur transition-all duration-300 ${
          showUI ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
            className="h-8 w-8 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-medium truncate" data-testid="text-book-title">
              {book.title}
            </h1>
            <p className="text-xs text-muted-foreground truncate">{chapterTitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* TOC */}
          <Sheet open={tocOpen} onOpenChange={setTocOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-toc">
                <List className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <SheetHeader className="p-4 pb-2">
                <SheetTitle className="text-sm">Contents</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-60px)]">
                <div className="px-2 pb-4">
                  <TocTree items={toc} onSelect={goToChapter} depth={0} />
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>

          {/* Bookmarks */}
          <Sheet open={bookmarksOpen} onOpenChange={setBookmarksOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-bookmarks-list">
                <Bookmark className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 p-0">
              <SheetHeader className="p-4 pb-2">
                <SheetTitle className="text-sm">Bookmarks</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-60px)]">
                <div className="px-2 pb-4">
                  {bookmarks.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No bookmarks yet. Tap the bookmark icon while reading to save your place.
                    </p>
                  ) : (
                    bookmarks.map((bm) => (
                      <div
                        key={bm.id}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-md hover:bg-muted/50 cursor-pointer group"
                        onClick={() => goToBookmark(bm.cfi)}
                        data-testid={`bookmark-item-${bm.id}`}
                      >
                        <BookmarkCheck className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm truncate flex-1">{bm.label || "Bookmark"}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBookmarkMutation.mutate(bm.id);
                          }}
                        >
                          <Trash2Icon className="w-3 h-3" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>

          {/* Add/Remove bookmark on current page */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleBookmark}
            data-testid="button-bookmark-toggle"
          >
            {isBookmarkOnPage ? (
              <BookmarkCheck className="w-4 h-4 text-primary" />
            ) : (
              <Bookmark className="w-4 h-4" />
            )}
          </Button>

          {/* Settings */}
          <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-settings">
                <Settings className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle className="text-sm">Display Settings</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                {/* Theme toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Theme</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleTheme}
                    className="gap-2 h-8"
                    data-testid="button-settings-theme"
                  >
                    {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    {theme === "dark" ? "Light" : "Dark"}
                  </Button>
                </div>

                {/* Font size */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Type className="w-3.5 h-3.5" /> Font Size
                    </span>
                    <span className="text-xs text-muted-foreground">{fontSize}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setFontSize((s) => Math.max(60, s - 10))}
                      data-testid="button-font-decrease"
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <Slider
                      value={[fontSize]}
                      onValueChange={([v]) => setFontSize(v)}
                      min={60}
                      max={200}
                      step={10}
                      className="flex-1"
                      data-testid="slider-font-size"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setFontSize((s) => Math.min(200, s + 10))}
                      data-testid="button-font-increase"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Reader area */}
      <div className="flex-1 relative overflow-hidden" onClick={toggleUIVisibility}>
        {/* Navigation zones */}
        <button
          className="absolute left-0 top-0 bottom-0 w-1/4 z-10 cursor-w-resize"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          data-testid="button-prev-page"
          aria-label="Previous page"
        />
        <button
          className="absolute right-0 top-0 bottom-0 w-1/4 z-10 cursor-e-resize"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          data-testid="button-next-page"
          aria-label="Next page"
        />

        {/* EPUB renders here */}
        <div
          ref={viewerRef}
          className="w-full h-full"
          data-testid="epub-viewer"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Bottom bar */}
      <footer
        className={`flex items-center justify-between px-4 py-2 border-t border-border bg-background/95 backdrop-blur transition-all duration-300 ${
          showUI ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goPrev} data-testid="button-prev">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 mx-4 flex items-center gap-3">
          <Progress value={progress} className="flex-1 h-1.5" data-testid="progress-reading" />
          <span className="text-xs text-muted-foreground tabular-nums w-10 text-right shrink-0">
            {progress}%
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goNext} data-testid="button-next">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </footer>
    </div>
  );
}

function TocTree({ items, onSelect, depth }: { items: NavItem[]; onSelect: (href: string) => void; depth: number }) {
  return (
    <>
      {items.map((item, i) => (
        <div key={item.id || i}>
          <button
            className="w-full text-left text-sm px-3 py-2 rounded-md hover:bg-muted/50 transition-colors truncate"
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => onSelect(item.href)}
            data-testid={`toc-item-${i}`}
          >
            {item.label?.trim()}
          </button>
          {item.subitems && item.subitems.length > 0 && (
            <TocTree items={item.subitems} onSelect={onSelect} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  );
}

function Trash2Icon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>
  );
}

function findTocItem(items: NavItem[], href: string): NavItem | null {
  for (const item of items) {
    if (href.includes(item.href?.split("#")[0] || "___")) return item;
    if (item.subitems) {
      const found = findTocItem(item.subitems, href);
      if (found) return found;
    }
  }
  return null;
}
