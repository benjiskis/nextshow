// Groups.jsx — v0.2.0
import { useEffect, useState } from 'react'
import {
  getMyGroups,
  getGroupMembers,
  createGroup,
  getMutuallyStarredShows,
} from '../lib/supabase'
import ShowCard from './ShowCard.jsx'

export default function Groups({ userId }) {
  const [groups, setGroups] = useState([])
  const [membersByGroup, setMembersByGroup] = useState({})
  const [mutualShowsByGroup, setMutualShowsByGroup] = useState({})
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    refresh()
  }, [userId])

  async function refresh() {
    setLoading(true)
    const myGroups = await getMyGroups(userId)
    const memberLists = await Promise.all(myGroups.map((g) => getGroupMembers(g.id)))
    const membersMap = {}
    myGroups.forEach((g, i) => (membersMap[g.id] = memberLists[i]))

    const mutualLists = await Promise.all(
      memberLists.map((members) => getMutuallyStarredShows(members.map((m) => m.id)))
    )
    const mutualMap = {}
    myGroups.forEach((g, i) => {
      const nameById = new Map(memberLists[i].map((m) => [m.id, m.display_name]))
      mutualMap[g.id] = mutualLists[i].map((show) => ({
        ...show,
        interestedUsers: show.interestedUserIds.map((id) => ({
          id,
          display_name: nameById.get(id),
        })),
      }))
    })

    setGroups(myGroups)
    setMembersByGroup(membersMap)
    setMutualShowsByGroup(mutualMap)
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    try {
      await createGroup(trimmed, userId)
      setName('')
      await refresh()
    } finally {
      setCreating(false)
    }
  }

  function handleCopyInvite(groupId) {
    const url = `${window.location.origin}${window.location.pathname}?joinGroup=${groupId}`
    navigator.clipboard.writeText(url)
    setCopiedId(groupId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div>
      <form className="group-create-form" onSubmit={handleCreate}>
        <input
          type="text"
          className="search-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New group name..."
        />
        <button className="btn btn-ghost" type="submit" disabled={creating || !name.trim()}>
          Create
        </button>
      </form>

      {loading ? (
        <p className="muted">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="muted">No groups yet — create one, or join via an invite link.</p>
      ) : (
        <ul className="group-list">
          {groups.map((group) => (
            <li key={group.id} className="group-card">
              <div className="group-name">{group.name}</div>
              <div className="group-members muted">
                {(membersByGroup[group.id] ?? []).map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ', '}
                    {m.id === userId ? (
                      'You'
                    ) : (
                      <a
                        className="member-link"
                        href={`${window.location.pathname}?profile=${m.id}`}
                        title={`See ${m.display_name}'s wishlist and starred shows`}
                      >
                        {m.display_name}
                      </a>
                    )}
                  </span>
                ))}
              </div>
              <button className="btn-link" onClick={() => handleCopyInvite(group.id)}>
                {copiedId === group.id ? 'Invite link copied!' : 'Copy invite link'}
              </button>

              {(membersByGroup[group.id]?.length ?? 0) >= 2 && (
                <div className="mutual-shows">
                  <div className="mutual-shows-label">🎯 Mutual interest</div>
                  {(mutualShowsByGroup[group.id] ?? []).length === 0 ? (
                    <p className="muted mutual-shows-empty">
                      No shows yet where 2+ of you are both in.
                    </p>
                  ) : (
                    <ul className="show-list">
                      {mutualShowsByGroup[group.id].map((show) => (
                        <ShowCard key={show.id} show={show} viewerUserId={userId} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
