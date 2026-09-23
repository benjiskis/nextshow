// Shows.jsx — v0.2.0
import { useEffect, useMemo, useState } from 'react'
import { getUpcomingShows, updateUserLocation } from '../lib/supabase'
import { distanceMiles, requestLocation } from '../lib/geo'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const sourceLabels = {
  ticketmaster: 'Ticketmaster',
  jambase: 'Jambase',
  bandsintown: 'Bandsintown',
}

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
      .then(setShows)
      .finally(() => setLoading(false))
  }, [user.id, refreshKey])

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

  const visibleShows = radius
    ? showsWithDistance.filter((show) => show.distance == null || show.distance <= radius)
    : showsWithDistance

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

      {loading ? (
        <p className="muted">Loading shows...</p>
      ) : visibleShows.length === 0 ? (
        <p className="muted">
          {shows.length === 0
            ? 'No upcoming shows yet. Add artists to your wishlist, then run the ingestion script.'
            : 'No shows within that distance.'}
        </p>
      ) : (
        <ul className="show-list">
          {visibleShows.map((show) => (
            <li key={show.id} className="show-card">
              {show.artist.logo_url && (
                <img className="show-logo" src={show.artist.logo_url} alt="" width={44} height={44} />
              )}
              <div className="show-info">
                <div className="show-artist">{show.artist.name}</div>
                <div className="show-meta">
                  {dateFormatter.format(new Date(show.event_date))}
                  {show.venue_name && <> · {show.venue_name}</>}
                  {(show.city || show.state) && (
                    <> · {[show.city, show.state].filter(Boolean).join(', ')}</>
                  )}
                  {show.distance != null && <> · {Math.round(show.distance)} mi away</>}
                </div>
                <div className="show-links">
                  {show.links.map((link) => (
                    <a
                      key={link.source}
                      className="ticket-link"
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Tickets ({sourceLabels[link.source] ?? link.source})
                    </a>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
