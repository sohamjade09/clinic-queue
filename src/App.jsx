import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabase'
import Auth from './Auth'
import Dashboard from './Dashboard'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="center">Loading...</div>

  return (
    <Routes>
      <Route path="/" element={session ? <Dashboard session={session} /> : <Auth />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}