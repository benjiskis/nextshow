// App.jsx — v0.1.0
import { useEffect, useState } from 'react'
import { watchAuthState } from './lib/firebase'
import { ensureUserRow } from './lib/supabase'
import Login from './components/Login.jsx'
import Wishlist from './components/Wishlist.jsx'
import Shows from './components/Shows.jsx'
import Groups from './components/Groups.jsx'
import SharedProfile from './components/SharedProfile.jsx'
import JoinGroup from './components/JoinGroup.jsx'

export default function App() {
  const [user, setUser] = useState(null)
  const [dbUser, setDbUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [wishlistVersion, setWishlistVersion] = useState(0)

  const params = new URLSearchParams(window.location.search)
  const sharedUserId = params.get('profile')
  const joinGroupId = params.get('joinGroup')

  useEffect(() => {
    const unsubscribe = watchAuthState(async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const row = await ensureUserRow(firebaseUser)
        setDbUser(row)
      } else {
        setDbUser(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  if (joinGroupId) {
    return (
      <JoinGroup
        groupId={joinGroupId}
        viewerUser={user}
        viewerDbUser={dbUser}
        authLoading={loading}
      />
    )
  }

  if (sharedUserId) {
    return (
      <SharedProfile
        userId={sharedUserId}
        viewerUser={user}
        viewerDbUser={dbUser}
        authLoading={loading}
      />
    )
  }

  if (loading) return <p className="muted">Loading...</p>

  return (
    <div className="app">
      <header className="app-header">
        <h1>Tour Wishlist</h1>
        <Login user={user} />
      </header>
      {dbUser && (
        <>
          <section className="section">
            <h2>Wishlist</h2>
            <Wishlist userId={dbUser.id} onChange={() => setWishlistVersion((v) => v + 1)} />
          </section>
          <section className="section">
            <h2>Groups</h2>
            <Groups userId={dbUser.id} />
          </section>
          <section className="section">
            <h2>Upcoming shows</h2>
            <Shows user={dbUser} refreshKey={wishlistVersion} />
          </section>
        </>
      )}
    </div>
  )
}
