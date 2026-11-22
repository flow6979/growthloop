"""Tools agents can use. Every tool result that comes from outside is wrapped as untrusted data."""
from __future__ import annotations

import os

import httpx

from .guardrails import untrusted


def web_search_available() -> bool:
    return bool(os.environ.get("TAVILY_API_KEY") or os.environ.get("BRAVE_API_KEY"))


def web_search(query: str, max_results: int = 5) -> list[dict]:
    """Returns [{title, url, snippet}]. Tavily or Brave if a key is set; otherwise empty."""
    try:
        if key := os.environ.get("TAVILY_API_KEY"):
            r = httpx.post("https://api.tavily.com/search", timeout=30,
                           json={"api_key": key, "query": query, "max_results": max_results})
            r.raise_for_status()
            return [{"title": x.get("title", ""), "url": x.get("url", ""), "snippet": x.get("content", "")[:600]}
                    for x in r.json().get("results", [])]
        if key := os.environ.get("BRAVE_API_KEY"):
            r = httpx.get("https://api.search.brave.com/res/v1/web/search", timeout=30,
                          params={"q": query, "count": max_results},
                          headers={"X-Subscription-Token": key, "Accept": "application/json"})
            r.raise_for_status()
            return [{"title": x.get("title", ""), "url": x.get("url", ""), "snippet": x.get("description", "")[:600]}
                    for x in r.json().get("web", {}).get("results", [])]
    except httpx.HTTPError:
        return []
    return []


def research_digest(queries: list[str]) -> tuple[str, list[str]]:
    """Runs several searches and returns (untrusted digest text, list of source urls)."""
    if not web_search_available():
        return ("No live web search configured (set TAVILY_API_KEY or BRAVE_API_KEY). "
                "Use your own knowledge and label it as such.", [])
    lines, urls = [], []
    for q in queries:
        for hit in web_search(q):
            lines.append(f"- {hit['title']} ({hit['url']}): {hit['snippet']}")
            urls.append(hit["url"])
    return untrusted("\n".join(lines) or "no results"), urls
