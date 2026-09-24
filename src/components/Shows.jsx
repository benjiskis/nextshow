// Shows.jsx — v0.3.0
import { useEffect, useMemo, useState } from 'react'
import {
  getUpcomingShows,
  getSavedShowIds,
  setShowSaved,
  updateUserLocation,
  getInterestedUsersByShow,
  withInterestedUsers,
} from '../lib/supabase'
import { distanceMiles, requestLocation } from '../lib/geo'
import ShowCard from './ShowCard.jsx'

const RADIUS_OPTIONS = [
  { label: 'Any distance', value: null },
  { label: 'Within 50 mi', value: 50 },
  { label: 'Within 100 mi', value: 100 },
  { label: 'Within 250 mi', value: 250 },
  { label: 'Within 500 mi', value: 500 },
]

export default function Shows({ user, refreshKey }) {
  const [shows, setShows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savedIds, setSavedIds] = useState(new Set())
  const [savedOnly, setSavedOnly] = useState(false)
  const [copied, setCopied] = useState(false)
  const [location, setLocation] = useState(
    user.latitude != null && user.longitude != null
      ? { latitude: user.latitude, longitude: user.longitude }
      : null
  )
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState(null)
  const [radius, setRadius] = useState(null)

  useEffect(() => {
    setLoading(true)
    getUpcomingShows(user.id)
      .then(async (rows) => {
        const allShowIds = rows.flatMap((show) => show.showIds)
        const [saved, interested] = await Promise.all([
          getSavedShowIds(user.id, allShowIds),
          getInterestedUsersByShow(allShowIds),
        ])
        setShows(withInterestedUsers(rows, interested))
        setSavedIds(saved)
      })
      .finally(() => setLoading(false))
  }, [user.id, refreshKey])

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
      await setShowSaved(user.id, show.showIds, !wasSaved)
    } catch (err) {
      console.error('Failed to save show:', err)
      applySavedState(show.showIds, wasSaved) // revert
    }
  }

  async function handleShareLocation() {
    setLocating(true)
    setLocationError(null)
    try {
      const loc = await requestLocation()
      await updateUserLocation(user.id, loc)
      setLocation(loc)
    } catch (err) {
      setLocationError(err.message ?? 'Could not get your location.')
    } finally {
      setLocating(false)
    }
  }

  function handleCopyShareLink() {
    const url = `${window.location.origin}${window.location.pathname}?profile=${user.id}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const showsWithDistance = useMemo(() => {
    if (!location) return shows.map((show) => ({ ...show, distance: null }))
    return shows.map((show) => ({
      ...show,
      distance:
        show.latitude != null && show.longitude != null
          ? distanceMiles(location.latitude, location.longitude, show.latitude, show.longitude)
          : null,
    }))
  }, [shows, location])

  const visibleShows = showsWithDistance
    .filter((show) => !radius || show.distance == null || show.distance <= radius)
    .filter((show) => !savedOnly || show.showIds.some((id) => savedIds.has(id)))

  return (
    <div>
      <div className="location-bar">
        {location ? (
          <>
            <select
              className="radius-select"
              value={radius ?? ''}
              onChange={(e) => setRadius(e.target.value ? Number(e.target.value) : null)}
            >
              {RADIUS_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value ?? ''}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button className="btn-link" onClick={handleShareLocation} disabled={locating}>
              {locating ? 'Updating…' : 'Update location'}
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={handleShareLocation} disabled={locating}>
            {locating ? 'Getting location…' : 'Share location for nearby shows'}
          </button>
        )}
        {locationError && <span className="muted error-text">{locationError}</span>}
      </div>

      <div className="location-bar">
        <label className="saved-only-toggle">
          <input
            type="checkbox"
            checked={savedOnly}
            onChange={(e) => setSavedOnly(e.target.checked)}
          />
          Saved only
        </label>
        <button className="btn-link" onClick={handleCopyShareLink}>
          {copied ? 'Link copied!' : 'Copy shareable link to my profile'}
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading shows...</p>
      ) : visibleShows.length === 0 ? (
        <p className="muted">
          {shows.length === 0
            ? 'No upcoming shows yet. Add artists to your wishlist, then run the ingestion script.'
            : savedOnly
              ? 'No saved shows yet — click the star on a show to save it.'
              : 'No shows within that distance.'}
        </p>
      ) : (
        <ul className="show-list">
          {visibleShows.map((show) => (
            <ShowCard
              key={show.id}
              show={show}
              saved={show.showIds.some((id) => savedIds.has(id))}
              onToggleSave={() => handleToggleSave(show)}
              viewerUserId={user.id}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
