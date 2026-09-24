// JoinGroup.jsx — v0.1.0
// The ?joinGroup=<id> invite link. Requires an explicit "Join" click —
// visiting the link alone doesn't add you, since a link can be opened
// accidentally (or by a preview crawler) and joining is a real action.
import { useEffect, useState } from 'react'
import { getGroup, getGroupMembers, joinGroupById } from '../lib/supabase'
import Login from './Login.jsx'

export default function JoinGroup({ groupId, viewerUser, viewerDbUser, authLoading }) {
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    Promise.all([getGroup(groupId), getGroupMembers(groupId)])
      .then(([g, m]) => {
        setGroup(g)
        setMembers(m)
      })
      .catch(() => setError("Couldn't load this invite link."))
      .finally(() => setLoading(false))
  }, [groupId])

  const alreadyJoined = viewerDbUser && members.some((m) => m.id === viewerDbUser.id)

  async function handleJoin() {
    setJoining(true)
    try {
      await joinGroupById(groupId, viewerDbUser.id)
      setMembers((prev) => [...prev, { id: viewerDbUser.id, display_name: viewerUser.displayName }])
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>{group ? `Join "${group.name}"` : 'Group invite'}</h1>
      </header>

      {loading ? (
        <p className="muted">Loading...</p>
      ) : error ? (
        <p className="muted error-text">{error}</p>
      ) : (
        <>
          <p className="muted">
            Members: {members.map((m) => m.display_name).join(', ') || 'none yet'}
          </p>

          {authLoading ? (
            <p className="muted">Checking sign-in…</p>
          ) : !viewerDbUser ? (
            <>
              <p className="muted">Sign in to join this group.</p>
              <Login user={viewerUser} />
            </>
          ) : alreadyJoined ? (
            <>
              <p>You're in! 🎉</p>
              <a className="btn-link" href={window.location.pathname}>
                Go to my dashboard →
              </a>
            </>
          ) : (
            <button className="btn" onClick={handleJoin} disabled={joining}>
              {joining ? 'Joining…' : `Join ${group?.name}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
