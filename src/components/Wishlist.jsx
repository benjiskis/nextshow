// Wishlist.jsx — v0.1.0
import { useEffect, useState } from 'react'
import {
  searchArtists,
  findOrCreateArtist,
  findOrCreateArtistFromTicketmaster,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} from '../lib/supabase'
import { searchTicketmasterArtists } from '../lib/ticketmaster'

export default function Wishlist({ userId, onChange }) {
  const [wishlist, setWishlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [externalResults, setExternalResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    getWishlist(userId)
      .then(setWishlist)
      .finally(() => setLoading(false))
  }, [userId])

  // Search our own artists table first; only hit Ticketmaster's live API
  // when that comes up empty, so a typed artist can still be found (and
  // added with a correct name + ID) even if it's never been ingested.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setExternalResults([])
      return
    }
    const timeout = setTimeout(async () => {
      const local = await searchArtists(trimmed)
      setResults(local)
      if (local.length === 0) {
        setSearching(true)
        setExternalResults(await searchTicketmasterArtists(trimmed))
        setSearching(false)
      } else {
        setExternalResults([])
      }
    }, 250)
    return () => clearTimeout(timeout)
  }, [query])

  async function handleAdd(artist) {
    await addToWishlist(userId, artist.id)
    setWishlist((prev) => [...prev, artist])
    setQuery('')
    setResults([])
    setExternalResults([])
    onChange?.()
  }

  async function handleAddExternal(suggestion) {
    const artist = await findOrCreateArtistFromTicketmaster(suggestion)
    await handleAdd(artist)
  }

  async function handleAddNew() {
    const artist = await findOrCreateArtist(query)
    await handleAdd(artist)
  }

  async function handleRemove(artistId) {
    await removeFromWishlist(userId, artistId)
    setWishlist((prev) => prev.filter((artist) => artist.id !== artistId))
    onChange?.()
  }

  const onWishlist = new Set(wishlist.map((artist) => artist.id))
  const trimmedQuery = query.trim()

  return (
    <div>
      <input
        type="text"
        className="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for an artist..."
      />

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((artist) => (
            <li key={artist.id}>
              {artist.name}
              {onWishlist.has(artist.id) ? (
                <span className="muted">Added</span>
              ) : (
                <button className="btn btn-ghost" onClick={() => handleAdd(artist)}>
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {results.length === 0 && externalResults.length > 0 && (
        <ul className="search-results">
          {externalResults.map((suggestion) => (
            <li key={suggestion.ticketmasterId}>
              {suggestion.name}
              <button className="btn btn-ghost" onClick={() => handleAddExternal(suggestion)}>
                Add
              </button>
            </li>
          ))}
        </ul>
      )}

      {trimmedQuery && !searching && results.length === 0 && externalResults.length === 0 && (
        <button className="add-new-btn" onClick={handleAddNew}>
          Add "{trimmedQuery}" as new artist
        </button>
      )}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : wishlist.length === 0 ? (
        <p className="muted">No artists yet.</p>
      ) : (
        <ul className="wishlist-chips">
          {wishlist.map((artist) => (
            <li key={artist.id} className="chip">
              {artist.name}
              <button
                className="chip-remove"
                onClick={() => handleRemove(artist.id)}
                aria-label={`Remove ${artist.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
