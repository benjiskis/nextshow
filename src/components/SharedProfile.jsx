// SharedProfile.jsx — v0.1.0
// Read-only-until-you-sign-in view behind the ?profile=<userId> shareable
// link — someone's wishlist (artists they're tracking) and saved shows
// (?saved= previously; folded into one link so there's only ever one
// URL to share, instead of a separate link per kind of data). Anyone can
// view it (RLS currently allows anon reads; see the RLS-hardening TODO
// in schema.sql), but saying "I'm in" on a show requires signing in —
// votes need a durable, attributable identity.
import { useEffect, useState } from 'react'
import {
  getWishlist,
  getSavedShows,
  getUserDisplayName,
  getSavedShowIds,
  setShowSaved,
  getInterestedUsersByShow,
  withInterestedUsers,
  findOrCreateFriendGroup,
  addToWishlist,
} from '../lib/supabase'
import ShowCard from './ShowCard.jsx'
import Login from './Login.jsx'

export default function SharedProfile({ userId, viewerUser, viewerDbUser, authLoading }) {
  const [ownerName, setOwnerName] = useState(null)
  const [wishlist, setWishlist] = useState([])
  const [shows, setShows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savedIds, setSavedIds] = useState(new Set())
  const [myWishlistIds, setMyWishlistIds] = useState(new Set())
  const [crewState, setCrewState] = useState('idle') // idle | adding | added

  useEffect(() => {
    Promise.all([getUserDisplayName(userId), getWishlist(userId), getSavedShows(userId)])
      .then(async ([name, artists, savedShows]) => {
        setOwnerName(name)
        setWishlist(artists)
        const allShowIds = savedShows.flatMap((show) => show.showIds)
        const [interested, mine, myWishlist] = await Promise.all([
          getInterestedUsersByShow(allShowIds),
          viewerDbUser ? getSavedShowIds(viewerDbUser.id, allShowIds) : new Set(),
          viewerDbUser ? getWishlist(viewerDbUser.id) : [],
        ])
        setShows(withInterestedUsers(savedShows, interested))
        setSavedIds(mine)
        setMyWishlistIds(new Set(myWishlist.map((a) => a.id)))
      })
      .catch(() => setError("Couldn't load this profile link."))
      .finally(() => setLoading(false))
  }, [userId, viewerDbUser])

  function applySavedState(showIds, saved) {
    setSavedIds((prev) => {
      const next = new Set(prev)
      for (const id of showIds) {
        if (saved) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function handleToggleSave(show) {
    const wasSaved = show.showIds.some((id) => savedIds.has(id))
    applySavedState(show.showIds, !wasSaved)
    try {
      await setShowSaved(viewerDbUser.id, show.showIds, !wasSaved)
    } catch (err) {
      console.error('Failed to save show:', err)
      applySavedState(show.showIds, wasSaved) // revert
    }
  }

  async function handleAddArtist(artist) {
    setMyWishlistIds((prev) => new Set(prev).add(artist.id))
    try {
      await addToWishlist(viewerDbUser.id, artist.id)
    } catch (err) {
      console.error('Failed to add artist to wishlist:', err)
      setMyWishlistIds((prev) => {
        const next = new Set(prev)
        next.delete(artist.id)
        return next
      })
    }
  }

  async function handleAddCrew() {
    setCrewState('adding')
    try {
      await findOrCreateFriendGroup(userId, viewerDbUser.id)
      setCrewState('added')
    } catch (err) {
      console.error('Failed to add as crew:', err)
      setCrewState('idle')
    }
  }

  const isOwnLink = viewerDbUser?.id === userId

  return (
    <div className="app">
      <header className="app-header">
        <h1>{ownerName ? `${ownerName}'s profile` : 'Profile'}</h1>
      </header>

      <div className="location-bar">
        {authLoading ? (
          <span className="muted">Checking sign-in…</span>
        ) : viewerDbUser ? (
          <>
            <Login user={viewerUser} />
            <a className="btn-link" href={window.location.pathname}>
              Go to my dashboard →
            </a>
            {!isOwnLink && (
              <button className="btn-link" onClick={handleAddCrew} disabled={crewState === 'adding'}>
                {crewState === 'added'
                  ? '🤝 Added to crew!'
                  : crewState === 'adding'
                    ? 'Adding…'
                    : '🤝 Add as Crew'}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="muted">Sign in to say you're in on a show —</span>
            <Login user={viewerUser} />
          </>
        )}
      </div>

      {loading ? (
        <p className="muted">Loading...</p>
      ) : error ? (
        <p className="muted error-text">{error}</p>
      ) : (
        <>
          <section className="section">
            <h2>Wishlist</h2>
            {!viewerDbUser && wishlist.length > 0 && (
              <p className="muted">Sign in to add any of these to your own wishlist.</p>
            )}
            {wishlist.length === 0 ? (
              <p className="muted">No artists yet.</p>
            ) : (
              <ul className="wishlist-chips">
                {wishlist.map((artist) => {
                  const alreadyMine = myWishlistIds.has(artist.id)
                  return (
                    <li key={artist.id} className="chip">
                      {artist.name}
                      {viewerDbUser && !alreadyMine && (
                        <button
                          className="chip-add"
                          onClick={() => handleAddArtist(artist)}
                          aria-label={`Add ${artist.name} to my wishlist`}
                          title="Add to my wishlist"
                        >
                          +
                        </button>
                      )}
                      {alreadyMine && (
                        <span className="chip-added" title="Already on your wishlist">
                          ✓
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="section">
            <h2>Saved shows</h2>
            {shows.length === 0 ? (
              <p className="muted">No saved shows yet.</p>
            ) : (
              <ul className="show-list">
                {shows.map((show) => (
                  <ShowCard
                    key={show.id}
                    show={show}
                    saved={show.showIds.some((id) => savedIds.has(id))}
                    onToggleSave={viewerDbUser ? () => handleToggleSave(show) : undefined}
                    viewerUserId={viewerDbUser?.id}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
