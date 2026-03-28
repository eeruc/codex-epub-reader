import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.resolve("uploads");
const COVERS_DIR = path.resolve("covers");

// Ensure upload directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/epub+zip" || file.originalname.endsWith(".epub")) {
      cb(null, true);
    } else {
      cb(new Error("Only EPUB files are allowed"));
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Get all books
  app.get("/api/books", async (_req, res) => {
    const allBooks = await storage.getAllBooks();
    res.json(allBooks);
  });

  // Search books
  app.get("/api/books/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query) {
      const allBooks = await storage.getAllBooks();
      return res.json(allBooks);
    }
    const results = await storage.searchBooks(query);
    res.json(results);
  });

  // Get single book
  app.get("/api/books/:id", async (req, res) => {
    const book = await storage.getBook(Number(req.params.id));
    if (!book) return res.status(404).json({ message: "Book not found" });
    res.json(book);
  });

  // Upload a new book
  app.post("/api/books", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const filePath = req.file.path;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;

      // Extract metadata from EPUB using epubjs on the server
      let title = fileName.replace(/\.epub$/i, "");
      let author = "Unknown";
      let coverUrl: string | null = null;

      try {
        const EPub = (await import("epubjs")).default;
        const bookData = fs.readFileSync(filePath);
        const arrayBuffer = bookData.buffer.slice(
          bookData.byteOffset,
          bookData.byteOffset + bookData.byteLength
        );
        const epub = EPub(arrayBuffer as ArrayBuffer);
        await epub.ready;

        const metadata = epub.packaging?.metadata;
        if (metadata?.title) title = metadata.title;
        if (metadata?.creator) author = metadata.creator;

        // Extract cover image
        try {
          const coverHref = epub.packaging?.coverPath;
          if (coverHref) {
            const coverResource = epub.resources?.get(coverHref);
            if (coverResource) {
              // Try to get cover from archive
              const archive = (epub as any).archive;
              if (archive) {
                const coverData = await archive.getBlob(coverHref);
                if (coverData) {
                  const ext = path.extname(coverHref) || ".jpg";
                  const coverFileName = `${Date.now()}-cover${ext}`;
                  const coverPath = path.join(COVERS_DIR, coverFileName);
                  const buffer = Buffer.from(await coverData.arrayBuffer());
                  fs.writeFileSync(coverPath, buffer);
                  coverUrl = `/api/covers/${coverFileName}`;
                }
              }
            }
          }
        } catch (_e) {
          // Cover extraction is best-effort
        }

        epub.destroy();
      } catch (_e) {
        // Metadata extraction is best-effort, we still save the book
      }

      const book = await storage.createBook({
        title,
        author,
        coverUrl,
        fileName,
        filePath,
        fileSize,
        currentCfi: null,
        progress: 0,
        lastReadAt: null,
      });

      res.json(book);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Upload failed" });
    }
  });

  // Update book progress
  app.patch("/api/books/:id", async (req, res) => {
    const id = Number(req.params.id);
    const book = await storage.updateBook(id, req.body);
    if (!book) return res.status(404).json({ message: "Book not found" });
    res.json(book);
  });

  // Delete a book
  app.delete("/api/books/:id", async (req, res) => {
    const id = Number(req.params.id);
    const book = await storage.getBook(id);
    if (!book) return res.status(404).json({ message: "Book not found" });

    // Remove files
    try {
      if (fs.existsSync(book.filePath)) fs.unlinkSync(book.filePath);
      if (book.coverUrl) {
        const coverFile = path.join(COVERS_DIR, path.basename(book.coverUrl));
        if (fs.existsSync(coverFile)) fs.unlinkSync(coverFile);
      }
    } catch (_e) { /* best effort cleanup */ }

    await storage.deleteBook(id);
    res.json({ success: true });
  });

  // Serve EPUB files
  app.get("/api/books/:id/file", async (req, res) => {
    const book = await storage.getBook(Number(req.params.id));
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (!fs.existsSync(book.filePath)) return res.status(404).json({ message: "File not found" });
    res.setHeader("Content-Type", "application/epub+zip");
    res.setHeader("Content-Disposition", `inline; filename="${book.fileName}"`);
    res.sendFile(path.resolve(book.filePath));
  });

  // Serve cover images
  app.get("/api/covers/:filename", (req, res) => {
    const filePath = path.join(COVERS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Cover not found" });
    res.sendFile(filePath);
  });

  // Bookmarks
  app.get("/api/books/:id/bookmarks", async (req, res) => {
    const bmarks = await storage.getBookmarks(Number(req.params.id));
    res.json(bmarks);
  });

  app.post("/api/books/:id/bookmarks", async (req, res) => {
    const bookmark = await storage.createBookmark({
      bookId: Number(req.params.id),
      cfi: req.body.cfi,
      label: req.body.label || "",
      excerpt: req.body.excerpt || "",
    });
    res.json(bookmark);
  });

  app.delete("/api/bookmarks/:id", async (req, res) => {
    await storage.deleteBookmark(Number(req.params.id));
    res.json({ success: true });
  });

  return httpServer;
}
