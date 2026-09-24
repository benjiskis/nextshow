// vendor.js — v0.1.0
//
// Derives a human-readable ticket vendor from a ticket_url's domain.
// Needed because our internal `source` field (ticketmaster/jambase) is
// just which API we pulled the row from — Ticketmaster's own API
// sometimes returns two distinct events for the same real show when the
// venue actually sells through a different vendor (e.g. Red Rocks sells
// through AXS; Ticketmaster indexes it as its own event *and* an
// AXS-hosted one). Labeling by source alone shows "Tickets
// (Ticketmaster)" twice; labeling by actual domain tells them apart.

const VENDOR_LABELS = {
  'ticketmaster.com': 'Ticketmaster',
  'axs.com': 'AXS',
  'seatgeek.com': 'SeatGeek',
  'stubhub.com': 'StubHub',
  'vividseats.com': 'Vivid Seats',
  'vivid-seats.com': 'Vivid Seats',
  'gametime.co': 'Gametime',
  'tickpick.com': 'TickPick',
  'viagogo.com': 'Viagogo',
  'jambase.com': 'Jambase',
  'www.jambase.com': 'Jambase',
  'eventbrite.com': 'Eventbrite',
  'etix.com': 'Etix',
  'dice.fm': 'DICE',
  'seated.com': 'Seated',
}

function stripWww(hostname) {
  return hostname.replace(/^www\./, '')
}

// Affiliate link wrappers (evyy.net, pxf.io, hnyj8s.net, dgrk2e.net, ...)
// embed the real destination in a query param — usually `u`, sometimes
// `url`. Best-effort unwrap; falls back to the wrapper's own domain if
// neither param is present (e.g. prf.hn's path-based /destination:<url>
// scheme isn't handled — rare enough not to be worth the complexity).
function realHostname(url) {
  try {
    const parsed = new URL(url)
    const wrapped = parsed.searchParams.get('u') ?? parsed.searchParams.get('url')
    if (wrapped) return stripWww(new URL(wrapped).hostname)
    return stripWww(parsed.hostname)
  } catch {
    return null
  }
}

export function vendorFromUrl(url) {
  const hostname = realHostname(url)
  if (!hostname) return { key: 'unknown', label: 'Tickets' }
  return { key: hostname, label: VENDOR_LABELS[hostname] ?? hostname }
}
