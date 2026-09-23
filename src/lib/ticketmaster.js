// ticketmaster.js — v0.1.0
//
// Client-side live lookup against Ticketmaster's public Discovery API,
// used as a typeahead fallback when an artist search comes up empty in
// our own `artists` table — so adding a new artist pulls its canonical
// name + attraction ID + image directly from Ticketmaster instead of a
// freeform text row that has to wait for the next scheduled ingest run.
//
// Deliberately uses a VITE_-exposed key: Discovery API keys are meant
// for client-side/public use (rate-limited per key, not a secret
// credential) — unlike Jambase's metered trial key, which stays
// server-only and is only used by the batch ingestion script.

const API_KEY = import.meta.env.VITE_TICKETMASTER_API_KEY

function pickImage(images) {
  if (!images || images.length === 0) return null
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null
}

export async function searchTicketmasterArtists(query) {
  if (!API_KEY) return []
  const trimmed = query.trim()
  if (!trimmed) return []

  const url = new URL('https://app.ticketmaster.com/discovery/v2/attractions.json')
  url.searchParams.set('apikey', API_KEY)
  url.searchParams.set('keyword', trimmed)
  url.searchParams.set('classificationName', 'music')
  url.searchParams.set('size', '5')

  const res = await fetch(url)
  if (!res.ok) return []
  const body = await res.json()

  return (body._embedded?.attractions ?? []).map((attraction) => ({
    ticketmasterId: attraction.id,
    name: attraction.name,
    imageUrl: pickImage(attraction.images),
  }))
}
