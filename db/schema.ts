import { pgTable, serial, text, timestamp, boolean, integer, jsonb, index } from "drizzle-orm/pg-core";

export const notifications = pgTable("notifications", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull().default("general"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_notifications_user").on(table.userId),
  index("idx_notifications_user_read").on(table.userId, table.read),
]);

export const assistantFaqs = pgTable("assistant_faqs", {
  id: serial().primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category").notNull().default("general"),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
