// Wishlist.jsx — v0.1.0
import { useEffect, useState } from 'react'
import {
  searchArtists,
  findOrCreateArtist,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} from '../lib/supabase'

export default function Wishlist({ userId, onChange }) {
  const [wishlist, setWishlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  useEffect(() => {
    getWishlist(userId)
      .then(setWishlist)
      .finally(() => setLoading(false))
  }, [userId])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      return
    }
    const timeout = setTimeout(() => {
      searchArtists(trimmed).then(setResults)
    }, 250)
    return () => clearTimeout(timeout)
  }, [query])

  async function handleAdd(artist) {
    await addToWishlist(userId, artist.id)
    setWishlist((prev) => [...prev, artist])
    setQuery('')
    setResults([])
    onChange?.()
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
  const exactMatch = results.some(
    (artist) => artist.name.toLowerCase() === trimmedQuery.toLowerCase()
  )

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

      {trimmedQuery && !exactMatch && (
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
