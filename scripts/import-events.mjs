import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const input = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "data/events.hu.json";

try {
  const raw = JSON.parse(await readFile(path.resolve(input), "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("A JSON nem üres eseménylista legyen.");
  const seen = new Set();
  const events = raw.map((item, index) => {
    if (typeof item.title !== "string" || item.title.trim().length < 3 || item.title.length > 160
      || typeof item.description !== "string" || item.description.trim().length < 5 || item.description.length > 1000
      || (item.active !== undefined && typeof item.active !== "boolean")) {
      throw new Error(`Hibás esemény a(z) ${index + 1}. sorban.`);
    }
    const title = item.title.trim();
    if (seen.has(title)) throw new Error(`Ismétlődő cím: ${title}`);
    seen.add(title);
    return { title, description: item.description.trim(), active: item.active ?? true };
  });

  if (process.argv.includes("--sql")) {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const sql = "-- Generált fájl: npm run events:sql. Forrás: " + input + "\n"
      + "begin;\ninsert into public.events (title, description, active) values\n"
      + events.map((event) => `(${quote(event.title)}, ${quote(event.description)}, ${event.active})`).join(",\n")
      + "\non conflict (title) do update set description = excluded.description, active = excluded.active;\ncommit;\n";
    await writeFile("supabase/seed.sql", sql, "utf8");
    console.log(`${events.length} esemény SQL-je elkészült: supabase/seed.sql`);
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Az importhoz NEXT_PUBLIC_SUPABASE_URL és SUPABASE_SERVICE_ROLE_KEY szükséges a .env.local fájlban.");
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.from("events").upsert(events, { onConflict: "title" });
    if (error) throw error;
    console.log(`${events.length} esemény sikeresen importálva. Az azonos című események frissültek.`);
  }
} catch (error) {
  console.error("Sikertelen import:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
