import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export default function App() {
  const [status, setStatus] = useState('Checking connection...')

  useEffect(() => {
    supabase
      .from('clinics')
      .select('id')
      .limit(1)
      .then(({ error }) => {
        setStatus(error ? 'Supabase error: ' + error.message : 'Supabase connected ✅')
      })
  }, [])

  return <h1 style={{ fontFamily: 'sans-serif', padding: 24 }}>{status}</h1>
}