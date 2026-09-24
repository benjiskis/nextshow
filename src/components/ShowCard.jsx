// ShowCard.jsx — v0.1.0
// Presentational — shared by Shows.jsx (your dashboard, with the save
// toggle) and SharedSavedShows.jsx (someone else's saved list, read-only:
// no onToggleSave means the star doesn't render).

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export default function ShowCard({ show, saved, onToggleSave, viewerUserId }) {
  const interested = show.interestedUsers ?? []
  const names = interested.map((u) =>
    u.id === viewerUserId ? 'You' : u.display_name ?? 'Someone'
  )

  return (
    <li className="show-card">
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
              key={link.key}
              className="ticket-link"
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              Tickets ({link.label})
            </a>
          ))}
        </div>
        {names.length > 0 && <div className="show-interested">🙋 {names.join(', ')} in</div>}
      </div>
      {onToggleSave && (
        <button
          className={`save-btn${saved ? ' saved' : ''}`}
          onClick={onToggleSave}
          aria-label={saved ? `Unsave ${show.artist.name}` : `Save ${show.artist.name}`}
          title={saved ? 'Saved — click to unsave' : "Save — I want to go"}
        >
          {saved ? '★' : '☆'}
        </button>
      )}
    </li>
  )
}
