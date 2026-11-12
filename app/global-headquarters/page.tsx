import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";
import { HeadquartersMap } from "../headquarters-map";

export const metadata = { title: "Global Headquarters" };
export const dynamic = "force-dynamic";

export default async function GlobalHeadquartersPage() {
  if (!process.env.DATABASE_URL) return <main className="wrap"><h1>Global Headquarters</h1><p>Database not connected.</p></main>;
  try {
    await ensureSchema();
    const employers = await sql`
      select id, coalesce(official_name, name) as name, sector, headquarters_country as country
      from employers where active = true order by name
    ` as {id:number;name:string;sector:string|null;country:string|null}[];
    return <HeadquartersMap employers={employers}/>;
  } catch {
    return <main className="wrap"><h1>Global Headquarters</h1><p>Headquarters data is temporarily unavailable.</p></main>;
  }
}
