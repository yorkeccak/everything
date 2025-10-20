import { NextRequest, NextResponse } from "next/server";
import { Valyu } from "valyu-js";

// In-memory cache with timestamp (shared across function warm starts)
let memoryCache: {
  newsItems: any[];
  timestamp: number;
} | null = null;

async function fetchNewsData() {
  const valyuApiKey = process.env.VALYU_API_KEY;

  if (!valyuApiKey) {
    throw new Error("Valyu API key not configured");
  }

  const valyu = new Valyu(valyuApiKey, "https://api.valyu.ai/v1");

  // Search for international news from different countries and sources
  const newsQueries = [
    "international news today",
    "world news today",
    "European news today",
    "Asian news today",
    "African news today",
    "Latin American news today",
    "Middle East news today",
    "global politics today",
    "international business news today",
    "world sports news today",
  ];

  // Try multiple queries to get diverse news content
  let allResults: any[] = [];
  for (const query of newsQueries) {
    try {
      const response = await valyu.search(query);
      if (response?.results && response.results.length > 0) {
        allResults = [...allResults, ...response.results];
      }
    } catch (queryError) {
      console.error(`Error with query "${query}":`, queryError);
      // Continue with other queries
    }
  }

  if (allResults.length === 0) {
    throw new Error("No news articles found");
  }

  // Map results and remove duplicates
  const newsItems = allResults
    .map((item: any) => ({
      title: item.title || "News Article",
      url: item.url,
      image_url: item.image_url || null,
      content: item.content || "",
      source: item.metadata?.source || "News Source",
      date: item.metadata?.date || new Date().toISOString(),
    }))
    // Remove duplicates based on URL
    .filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.url === item.url)
    )
    // Remove duplicates based on title
    .filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.title === item.title)
    )
    // Ban Politico and USA Today sources
    .filter(
      (item) =>
        !item.url.toLowerCase().includes("politico") &&
        !item.source.toLowerCase().includes("politico") &&
        !item.title.toLowerCase().includes("politico") &&
        !item.url.toLowerCase().includes("usatoday") &&
        !item.source.toLowerCase().includes("usatoday") &&
        !item.title.toLowerCase().includes("usatoday")
    )
    // Limit to 30 articles for performance
    .slice(0, 30);

  return newsItems;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get("refresh") === "true";

    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

    // Check in-memory cache first
    if (memoryCache && !refresh) {
      const cacheAge = Date.now() - memoryCache.timestamp;
      if (cacheAge < oneHour) {
        return NextResponse.json({
          newsItems: memoryCache.newsItems,
          total: memoryCache.newsItems.length,
          cached: true,
        });
      }
    }

    const valyuApiKey = process.env.VALYU_API_KEY;

    if (!valyuApiKey) {
      return NextResponse.json(
        { error: "Valyu API key not configured" },
        { status: 500 }
      );
    }

    try {
      const newsItems = await fetchNewsData();

      // Update in-memory cache
      memoryCache = {
        newsItems,
        timestamp: Date.now(),
      };

      return NextResponse.json({
        newsItems: newsItems,
        total: newsItems.length,
        cached: false,
      });
    } catch (error) {
      console.error("Error fetching news:", error);

      // If we have stale cache, return it with a warning
      if (memoryCache) {
        return NextResponse.json({
          newsItems: memoryCache.newsItems,
          total: memoryCache.newsItems.length,
          cached: true,
          stale: true,
          error: "Failed to fetch fresh news, using cached data",
        });
      }

      return NextResponse.json(
        { error: "Failed to fetch news" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error in news API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
