// Login.jsx — v0.1.0
import { loginWithGoogle, logout } from '../lib/firebase'

export default function Login({ user }) {
  if (user) {
    return (
      <div className="login-signed-in">
        <span>{user.displayName}</span>
        <button className="btn btn-ghost" onClick={logout}>
          Sign out
        </button>
      </div>
    )
  }

  return (
    <button className="btn" onClick={loginWithGoogle}>
      Sign in with Google
    </button>
  )
}
