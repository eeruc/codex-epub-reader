import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen,
  Upload,
  Search,
  Trash2,
  Sun,
  Moon,
  Library as LibraryIcon,
} from "lucide-react";
import type { Book } from "@shared/schema";

export default function Library() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  const { data: books = [], isLoading } = useQuery<Book[]>({
    queryKey: ["/api/books"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("./api/books", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      toast({ title: "Book added to library" });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/books/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      toast({ title: "Book removed" });
    },
  });

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (file.name.endsWith(".epub")) {
        uploadMutation.mutate(file);
      }
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const filteredBooks = searchQuery
    ? books.filter(
        (b) =>
          b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.author.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : books;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <BookOpen className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight" data-testid="text-app-title">
              Codex
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              data-testid="button-theme-toggle"
              className="h-9 w-9"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
        {/* Search + Upload bar */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search your library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10"
              data-testid="input-search"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            data-testid="button-upload"
            className="h-10 gap-2"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Add Book</span>
          </Button>
        </div>

        {/* Empty / Loading / Book grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[2/3] bg-muted rounded-lg mb-2" />
                <div className="h-3 bg-muted rounded w-3/4 mb-1" />
                <div className="h-2.5 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredBooks.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center text-center py-20 px-6 rounded-xl border-2 border-dashed transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
              <LibraryIcon className="w-6 h-6 text-muted-foreground" />
            </div>
            <h2 className="text-base font-medium mb-1" data-testid="text-empty-title">
              {searchQuery ? "No matching books" : "Your library is empty"}
            </h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-xs">
              {searchQuery
                ? "Try a different search term"
                : "Drop an EPUB file here or tap the button above to add your first book."}
            </p>
            {!searchQuery && (
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-empty"
              >
                <Upload className="w-4 h-4 mr-2" />
                Browse files
              </Button>
            )}
          </div>
        ) : (
          <div
            className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 rounded-xl transition-colors ${
              isDragging ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {filteredBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onOpen={() => setLocation(`/reader/${book.id}`)}
                onDelete={() => deleteMutation.mutate(book.id)}
                formatFileSize={formatFileSize}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function BookCard({
  book,
  onOpen,
  onDelete,
  formatFileSize,
}: {
  book: Book;
  onOpen: () => void;
  onDelete: () => void;
  formatFileSize: (n: number) => string;
}) {
  return (
    <div
      className="group relative cursor-pointer"
      data-testid={`card-book-${book.id}`}
    >
      <div
        className="aspect-[2/3] rounded-lg overflow-hidden bg-muted mb-2 relative"
        onClick={onOpen}
      >
        {book.coverUrl ? (
          <img
            src={`.${book.coverUrl}`}
            alt={book.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-b from-card to-muted">
            <BookOpen className="w-8 h-8 text-muted-foreground mb-2" />
            <span className="text-xs text-muted-foreground text-center line-clamp-3 font-medium leading-tight">
              {book.title}
            </span>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-background/90 backdrop-blur-sm rounded-full p-3">
              <BookOpen className="w-5 h-5 text-foreground" />
            </div>
          </div>
        </div>
        {/* Progress bar */}
        {book.progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0">
            <Progress value={book.progress} className="h-1 rounded-none bg-black/20" />
          </div>
        )}
      </div>
      <div className="px-0.5">
        <h3
          className="text-sm font-medium leading-tight line-clamp-2 mb-0.5"
          data-testid={`text-title-${book.id}`}
        >
          {book.title}
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted-foreground">{formatFileSize(book.fileSize)}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            data-testid={`button-delete-${book.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
