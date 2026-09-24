// SharedSavedShows.jsx — v0.2.0
// Read-only-until-you-sign-in view behind the ?saved=<userId> shareable
// link. Anyone can view it (RLS currently allows anon reads; see the
// RLS-hardening TODO in schema.sql), but saying "I'm in" on a show
// requires signing in — votes need a durable, attributable identity.
import { useEffect, useState } from 'react'
import {
  getSavedShows,
  getUserDisplayName,
  getSavedShowIds,
  setShowSaved,
  getInterestedUsersByShow,
  withInterestedUsers,
} from '../lib/supabase'
import ShowCard from './ShowCard.jsx'
import Login from './Login.jsx'

export default function SharedSavedShows({ userId, viewerUser, viewerDbUser, authLoading }) {
  const [ownerName, setOwnerName] = useState(null)
  const [shows, setShows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savedIds, setSavedIds] = useState(new Set())

  useEffect(() => {
    Promise.all([getUserDisplayName(userId), getSavedShows(userId)])
      .then(async ([name, savedShows]) => {
        setOwnerName(name)
        const allShowIds = savedShows.flatMap((show) => show.showIds)
        const [interested, mine] = await Promise.all([
          getInterestedUsersByShow(allShowIds),
          viewerDbUser ? getSavedShowIds(viewerDbUser.id, allShowIds) : new Set(),
        ])
        setShows(withInterestedUsers(savedShows, interested))
        setSavedIds(mine)
      })
      .catch(() => setError("Couldn't load this saved-shows link."))
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>{ownerName ? `${ownerName}'s saved shows` : 'Saved shows'}</h1>
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
      ) : shows.length === 0 ? (
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
    </div>
  )
}
