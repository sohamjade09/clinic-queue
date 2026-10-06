import { useEffect, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { supabase } from './supabase'

export default function Dashboard({ session }) {
  const [clinic, setClinic] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [clinicForm, setClinicForm] = useState({ name: '', address: '' })
  const [docForm, setDocForm] = useState({ name: '', specialty: '', avg_consult_minutes: 10 })

  useEffect(() => {
    loadClinic()
    // eslint-disable-next-line
  }, [])

  async function loadClinic() {
    const { data, error } = await supabase
      .from('clinics')
      .select('*')
      .eq('user_id', session.user.id)
      .limit(1)
      .maybeSingle()
    if (error) setError(error.message)
    setClinic(data)
    if (data) await loadDoctors(data.id)
    setLoading(false)
  }

  async function loadDoctors(clinicId) {
    const { data, error } = await supabase
      .from('doctors')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at')
    if (error) setError(error.message)
    else setDoctors(data)
  }

  async function createClinic(e) {
    e.preventDefault()
    setError('')
    const { data, error } = await supabase
      .from('clinics')
      .insert({ user_id: session.user.id, name: clinicForm.name, address: clinicForm.address })
      .select()
      .single()
    if (error) setError(error.message)
    else setClinic(data)
  }

  async function addDoctor(e) {
    e.preventDefault()
    setError('')
    const { error } = await supabase.from('doctors').insert({
      clinic_id: clinic.id,
      name: docForm.name,
      specialty: docForm.specialty,
      avg_consult_minutes: Number(docForm.avg_consult_minutes) || 10,
    })
    if (error) setError(error.message)
    else {
      setDocForm({ name: '', specialty: '', avg_consult_minutes: 10 })
      loadDoctors(clinic.id)
    }
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('doctors').update({ status }).eq('id', id)
    if (error) setError(error.message)
    else loadDoctors(clinic.id)
  }

  async function deleteDoctor(id) {
    if (!window.confirm('Delete this doctor?')) return
    const { error } = await supabase.from('doctors').delete().eq('id', id)
    if (error) setError(error.message)
    else loadDoctors(clinic.id)
  }

  function downloadQR() {
    const canvas = document.getElementById('clinic-qr')
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = clinic.name.replace(/\s+/g, '-') + '-queue-qr.png'
    a.click()
  }

  function copyLink(link) {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <div className="center">Loading...</div>

  if (!clinic) {
    return (
      <div className="center">
        <form className="card" onSubmit={createClinic}>
          <h1>Set up your clinic</h1>
          <p className="muted">Enter your clinic details to get started.</p>
          {error && <div className="error">{error}</div>}
          <input placeholder="Clinic name" value={clinicForm.name} onChange={(e) => setClinicForm({ ...clinicForm, name: e.target.value })} required />
          <input placeholder="Address" value={clinicForm.address} onChange={(e) => setClinicForm({ ...clinicForm, address: e.target.value })} />
          <button className="full">Create clinic</button>
          <p style={{ textAlign: 'center', marginTop: 14 }}>
            <button type="button" className="link" onClick={() => supabase.auth.signOut()}>Log out</button>
          </p>
        </form>
      </div>
    )
  }

  const joinLink = window.location.origin + '/c/' + clinic.id

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>{clinic.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{clinic.address || 'No address added'}</p>
        </div>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Log out</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card section">
        <h2>Patient QR code</h2>
        <p className="muted">Print this and place it at the entrance and reception. Patients scan it to join the queue.</p>
        <div className="qrbox">
          <QRCodeCanvas id="clinic-qr" value={joinLink} size={220} includeMargin={true} />
        </div>
        <p className="muted" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{joinLink}</p>
        <div className="row">
          <button onClick={downloadQR}>Download QR</button>
          <button className="ghost" onClick={() => copyLink(joinLink)}>{copied ? 'Copied!' : 'Copy link'}</button>
        </div>
      </div>

      <form className="card section" onSubmit={addDoctor}>
        <h2>Add a doctor</h2>
        <input placeholder="Doctor name" value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })} required />
        <div className="row">
          <input placeholder="Specialty (e.g. General)" value={docForm.specialty} onChange={(e) => setDocForm({ ...docForm, specialty: e.target.value })} />
          <input type="number" min="1" placeholder="Avg consult (min)" value={docForm.avg_consult_minutes} onChange={(e) => setDocForm({ ...docForm, avg_consult_minutes: e.target.value })} />
        </div>
        <button className="full">Add doctor</button>
      </form>

      <div className="card section">
        <h2>Doctors ({doctors.length})</h2>
        {doctors.length === 0 && <p className="muted">No doctors yet. Add one above.</p>}
        {doctors.map((d) => (
          <div className="doctor" key={d.id}>
            <div>
              <strong>{d.name}</strong>
              <div className="muted" style={{ margin: 0 }}>
                {d.specialty || 'General'} · ~{d.avg_consult_minutes} min per patient
              </div>
            </div>
            <div className="actions">
              <select value={d.status} onChange={(e) => updateStatus(d.id, e.target.value)}>
                <option value="available">Available</option>
                <option value="paused">Paused</option>
                <option value="closed">Closed</option>
              </select>
              <button className="danger" onClick={() => deleteDoctor(d.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}