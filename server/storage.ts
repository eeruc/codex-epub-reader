import {
  type Book, type InsertBook, books,
  type Bookmark, type InsertBookmark, bookmarks,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, like, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  // Books
  getAllBooks(): Promise<Book[]>;
  getBook(id: number): Promise<Book | undefined>;
  createBook(book: InsertBook): Promise<Book>;
  updateBook(id: number, data: Partial<InsertBook>): Promise<Book | undefined>;
  deleteBook(id: number): Promise<void>;
  searchBooks(query: string): Promise<Book[]>;

  // Bookmarks
  getBookmarks(bookId: number): Promise<Bookmark[]>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getAllBooks(): Promise<Book[]> {
    return db.select().from(books).orderBy(desc(books.lastReadAt)).all();
  }

  async getBook(id: number): Promise<Book | undefined> {
    return db.select().from(books).where(eq(books.id, id)).get();
  }

  async createBook(book: InsertBook): Promise<Book> {
    return db.insert(books).values(book).returning().get();
  }

  async updateBook(id: number, data: Partial<InsertBook>): Promise<Book | undefined> {
    return db.update(books).set(data).where(eq(books.id, id)).returning().get();
  }

  async deleteBook(id: number): Promise<void> {
    db.delete(bookmarks).where(eq(bookmarks.bookId, id)).run();
    db.delete(books).where(eq(books.id, id)).run();
  }

  async searchBooks(query: string): Promise<Book[]> {
    return db.select().from(books)
      .where(like(books.title, `%${query}%`))
      .orderBy(desc(books.lastReadAt))
      .all();
  }

  // Bookmarks
  async getBookmarks(bookId: number): Promise<Bookmark[]> {
    return db.select().from(bookmarks).where(eq(bookmarks.bookId, bookId)).all();
  }

  async createBookmark(bookmark: InsertBookmark): Promise<Bookmark> {
    return db.insert(bookmarks).values(bookmark).returning().get();
  }

  async deleteBookmark(id: number): Promise<void> {
    db.delete(bookmarks).where(eq(bookmarks.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
