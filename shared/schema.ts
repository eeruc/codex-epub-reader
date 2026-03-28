import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const books = sqliteTable("books", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  author: text("author").notNull().default("Unknown"),
  coverUrl: text("cover_url"),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  currentCfi: text("current_cfi"),
  progress: integer("progress").notNull().default(0),
  lastReadAt: text("last_read_at"),
});

export const bookmarks = sqliteTable("bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookId: integer("book_id").notNull(),
  cfi: text("cfi").notNull(),
  label: text("label").notNull().default(""),
  excerpt: text("excerpt").notNull().default(""),
});

export const insertBookSchema = createInsertSchema(books).omit({ id: true });
export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ id: true });

export type InsertBook = z.infer<typeof insertBookSchema>;
export type Book = typeof books.$inferSelect;
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;
