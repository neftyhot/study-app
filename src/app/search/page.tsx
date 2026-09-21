import { SearchView } from "@/components/search/search-view";
import { searchScopes } from "@/lib/search";

export default async function SearchPage(props: PageProps<"/search">) {
  const params = await props.searchParams;
  const initial = typeof params.q === "string" ? params.q : "";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-muted-foreground text-sm">
          Across every subject and deck — cards, study-guide objectives, and the
          source material they came from.
        </p>
      </div>

      <SearchView scopes={await searchScopes()} initialQuery={initial} />
    </div>
  );
}
