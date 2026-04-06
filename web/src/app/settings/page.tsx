'use client'

import { useEffect, useRef, useState } from 'react'
import { getProfile, updateProfile, parseResume } from '@/lib/api-client'

const USER_ID = process.env.NEXT_PUBLIC_USER_ID || 'test-user-1'

interface ExperienceEntry {
  company: string
  title: string
  startDate: string
  endDate: string
  bullets: string[]
}

interface EducationEntry {
  institution: string
  degree: string
  field: string
}

interface ProfileFormData {
  phone: string
  location: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  personalEmail: string
  currentTitle: string
  yearsExperience: number
  summary: string
  skills: string[]
  experience: ExperienceEntry[]
  education: EducationEntry[]
  achievements: string[]
  targetRoles: string[]
  targetLocations: string[]
  remoteOnly: boolean
  minSalary: number
  visaRequired: boolean
}

const emptyProfile: ProfileFormData = {
  phone: '', location: '', linkedinUrl: '', githubUrl: '', portfolioUrl: '',
  personalEmail: '', currentTitle: '', yearsExperience: 0, summary: '',
  skills: [], experience: [], education: [], achievements: [],
  targetRoles: [], targetLocations: [],
  remoteOnly: false, minSalary: 0, visaRequired: false,
}

export default function SettingsPage() {
  const [form, setForm] = useState<ProfileFormData>(emptyProfile)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [skillInput, setSkillInput] = useState('')
  const [roleInput, setRoleInput] = useState('')
  const [locationInput, setLocationInput] = useState('')
  const [achievementInput, setAchievementInput] = useState('')
  const [bulletInputs, setBulletInputs] = useState<string[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadProfile() }, [])

  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || file.type !== 'application/pdf') return
    try {
      setParsing(true)
      setParseError('')

      // Extract text from PDF client-side using PDF.js
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      let text = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        text += (content.items as any[]).map((item) => item.str).join(' ') + '\n'
      }

      // Send extracted text to worker LLM parser
      const parsed = await parseResume(text)
      if (parsed.error) { setParseError(parsed.error); return }

      // Pre-fill form with parsed data
      const exp = Array.isArray(parsed.experience) ? parsed.experience : []
      setForm((prev) => ({
        ...prev,
        phone:           parsed.phone        || prev.phone,
        location:        parsed.location      || prev.location,
        linkedinUrl:     parsed.linkedinUrl   || prev.linkedinUrl,
        githubUrl:       parsed.githubUrl     || prev.githubUrl,
        personalEmail:   parsed.email         || prev.personalEmail,
        currentTitle:    parsed.currentTitle  || prev.currentTitle,
        yearsExperience: parsed.yearsExperience ?? prev.yearsExperience,
        summary:         parsed.summary       || prev.summary,
        skills:          parsed.skills?.length        ? parsed.skills        : prev.skills,
        experience:      exp.length                   ? exp                  : prev.experience,
        education:       parsed.education?.length     ? parsed.education     : prev.education,
        achievements:    parsed.achievements?.length  ? parsed.achievements  : prev.achievements,
      }))
      setBulletInputs(exp.map(() => ''))

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setParseError('Failed to read PDF. Make sure it is a text-based (not scanned) PDF.')
    } finally {
      setParsing(false)
    }
  }

  async function loadProfile() {
    try {
      setLoading(true)
      const data = await getProfile(USER_ID)
      if (data.profile) {
        const exp = safeJsonParse<ExperienceEntry[]>(data.profile.experience, [])
        setForm({
          phone: data.profile.phone || '',
          location: data.profile.location || '',
          linkedinUrl: data.profile.linkedin_url || '',
          githubUrl: data.profile.github_url || '',
          portfolioUrl: data.profile.portfolio_url || '',
          personalEmail: data.profile.personal_email || '',
          currentTitle: data.profile.current_title || '',
          yearsExperience: data.profile.years_experience || 0,
          summary: data.profile.summary || '',
          skills: safeJsonParse(data.profile.skills, []),
          experience: exp,
          education: safeJsonParse(data.profile.education, []),
          achievements: safeJsonParse(data.profile.achievements, []),
          targetRoles: safeJsonParse(data.profile.target_roles, []),
          targetLocations: safeJsonParse(data.profile.target_locations, []),
          remoteOnly: !!data.profile.remote_only,
          minSalary: data.profile.min_salary || 0,
          visaRequired: !!data.profile.visa_required,
        })
        setBulletInputs(exp.map(() => ''))
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      setSaving(true)
      await updateProfile({ ...form, userId: USER_ID })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(false)
    }
  }

  function addToList(key: keyof ProfileFormData, value: string, clearFn: (v: string) => void) {
    if (!value.trim()) return
    const current = form[key] as string[]
    if (!current.includes(value.trim())) {
      setForm({ ...form, [key]: [...current, value.trim()] })
    }
    clearFn('')
  }

  function removeFromList(key: keyof ProfileFormData, index: number) {
    const current = form[key] as string[]
    setForm({ ...form, [key]: current.filter((_, i) => i !== index) })
  }

  // ── Experience helpers ──────────────────────────────────────────────────
  function addExperience() {
    setForm({ ...form, experience: [...form.experience, { company: '', title: '', startDate: '', endDate: '', bullets: [] }] })
    setBulletInputs([...bulletInputs, ''])
  }

  function removeExperience(index: number) {
    setForm({ ...form, experience: form.experience.filter((_, i) => i !== index) })
    setBulletInputs(bulletInputs.filter((_, i) => i !== index))
  }

  function updateExperience(index: number, field: keyof ExperienceEntry, value: string) {
    setForm({ ...form, experience: form.experience.map((exp, i) => i === index ? { ...exp, [field]: value } : exp) })
  }

  function addBullet(expIndex: number) {
    const value = bulletInputs[expIndex]?.trim()
    if (!value) return
    setForm({ ...form, experience: form.experience.map((exp, i) => i === expIndex ? { ...exp, bullets: [...exp.bullets, value] } : exp) })
    setBulletInputs(bulletInputs.map((v, i) => (i === expIndex ? '' : v)))
  }

  function removeBullet(expIndex: number, bulletIndex: number) {
    setForm({ ...form, experience: form.experience.map((exp, i) => i === expIndex ? { ...exp, bullets: exp.bullets.filter((_, j) => j !== bulletIndex) } : exp) })
  }

  // ── Education helpers ───────────────────────────────────────────────────
  function addEducation() {
    setForm({ ...form, education: [...form.education, { institution: '', degree: '', field: '' }] })
  }

  function removeEducation(index: number) {
    setForm({ ...form, education: form.education.filter((_, i) => i !== index) })
  }

  function updateEducation(index: number, field: keyof EducationEntry, value: string) {
    setForm({ ...form, education: form.education.map((edu, i) => i === index ? { ...edu, [field]: value } : edu) })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-pulse text-surface-700">Loading profile...</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-text">Settings</span>
          </h1>
          <p className="text-surface-700 mt-1">Your profile and job search preferences.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
            saved
              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-brand-600 text-white hover:bg-brand-700 shadow-lg shadow-brand-600/25'
          }`}
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>

      {/* Resume Upload */}
      <div className="glass-card p-5 mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-surface-50">Auto-fill from Resume</p>
          <p className="text-xs text-surface-700 mt-0.5">
            Upload your PDF resume and the AI will extract your profile. You can edit anything after.
          </p>
          {parseError && <p className="text-xs text-red-400 mt-1">{parseError}</p>}
        </div>
        <div className="flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleResumeUpload}
            className="hidden"
            id="resume-upload"
          />
          <label
            htmlFor="resume-upload"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all ${
              parsing
                ? 'bg-brand-600/30 text-brand-400 cursor-not-allowed'
                : 'bg-brand-600/20 text-brand-400 border border-brand-500/30 hover:bg-brand-600/30'
            }`}
          >
            {parsing ? (
              <><span className="animate-spin">⟳</span> Parsing...</>
            ) : (
              <>📄 Upload PDF</>
            )}
          </label>
        </div>
      </div>

      <div className="space-y-6">

        {/* Personal Info */}
        <Section title="Personal Information">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Personal Email (Reply-To)" value={form.personalEmail}
              onChange={(v) => setForm({ ...form, personalEmail: v })} required />
            <Input label="Phone" value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })} />
            <Input label="Location" value={form.location}
              onChange={(v) => setForm({ ...form, location: v })} />
            <Input label="LinkedIn URL" value={form.linkedinUrl}
              onChange={(v) => setForm({ ...form, linkedinUrl: v })} />
            <Input label="GitHub URL" value={form.githubUrl}
              onChange={(v) => setForm({ ...form, githubUrl: v })} />
            <Input label="Portfolio URL" value={form.portfolioUrl}
              onChange={(v) => setForm({ ...form, portfolioUrl: v })} />
          </div>
        </Section>

        {/* Professional */}
        <Section title="Professional">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Current Title" value={form.currentTitle}
              onChange={(v) => setForm({ ...form, currentTitle: v })} />
            <Input label="Years of Experience" type="number" value={String(form.yearsExperience)}
              onChange={(v) => setForm({ ...form, yearsExperience: Number(v) })} />
          </div>
          <div className="mt-4">
            <label className="block text-xs text-surface-700 mb-1.5">Professional Summary</label>
            <textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              rows={3}
              className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 resize-none"
              placeholder="2-3 sentence professional summary used in cold emails and resume tailoring..."
            />
          </div>
        </Section>

        {/* Experience */}
        <Section title="Work Experience">
          <div className="space-y-4">
            {form.experience.length === 0 && (
              <p className="text-sm text-surface-700 text-center py-4">No experience added yet.</p>
            )}
            {form.experience.map((exp, expIndex) => (
              <div key={expIndex} className="border border-white/10 rounded-xl p-4 space-y-3 bg-black/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Position {expIndex + 1}</span>
                  <button onClick={() => removeExperience(expIndex)} className="text-xs text-red-400/60 hover:text-red-400 transition-colors">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Company" value={exp.company}
                    onChange={(v) => updateExperience(expIndex, 'company', v)} placeholder="e.g. Google" />
                  <Input label="Job Title" value={exp.title}
                    onChange={(v) => updateExperience(expIndex, 'title', v)} placeholder="e.g. Senior Software Engineer" />
                  <Input label="Start Date" value={exp.startDate}
                    onChange={(v) => updateExperience(expIndex, 'startDate', v)} placeholder="e.g. Jan 2022" />
                  <Input label="End Date" value={exp.endDate}
                    onChange={(v) => updateExperience(expIndex, 'endDate', v)} placeholder='e.g. Mar 2024 or "Present"' />
                </div>
                <div>
                  <label className="block text-xs text-surface-700 mb-1.5">
                    Bullet Points <span className="text-surface-800">(used by LLM to tailor resume)</span>
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {exp.bullets.map((bullet, bulletIndex) => (
                      <span key={bulletIndex} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-800/50 text-surface-300 rounded-lg text-xs">
                        {bullet}
                        <button onClick={() => removeBullet(expIndex, bulletIndex)} className="text-surface-600 hover:text-surface-300 text-sm">×</button>
                      </span>
                    ))}
                  </div>
                  <input
                    value={bulletInputs[expIndex] || ''}
                    onChange={(e) => { const u = [...bulletInputs]; u[expIndex] = e.target.value; setBulletInputs(u) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBullet(expIndex) } }}
                    placeholder='e.g. "Reduced API latency by 40%" — press Enter to add'
                    className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
              </div>
            ))}
            <button onClick={addExperience} className="w-full py-2.5 border border-dashed border-white/10 rounded-xl text-sm text-surface-700 hover:text-surface-400 hover:border-white/20 transition-colors">
              + Add Position
            </button>
          </div>
        </Section>

        {/* Education */}
        <Section title="Education">
          <div className="space-y-4">
            {form.education.length === 0 && (
              <p className="text-sm text-surface-700 text-center py-4">No education added yet.</p>
            )}
            {form.education.map((edu, eduIndex) => (
              <div key={eduIndex} className="border border-white/10 rounded-xl p-4 bg-black/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Degree {eduIndex + 1}</span>
                  <button onClick={() => removeEducation(eduIndex)} className="text-xs text-red-400/60 hover:text-red-400 transition-colors">Remove</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Input label="Institution" value={edu.institution}
                    onChange={(v) => updateEducation(eduIndex, 'institution', v)} placeholder="e.g. IIT Hyderabad" />
                  <Input label="Degree" value={edu.degree}
                    onChange={(v) => updateEducation(eduIndex, 'degree', v)} placeholder="e.g. B.Tech" />
                  <Input label="Field of Study" value={edu.field}
                    onChange={(v) => updateEducation(eduIndex, 'field', v)} placeholder="e.g. Computer Science" />
                </div>
              </div>
            ))}
            <button onClick={addEducation} className="w-full py-2.5 border border-dashed border-white/10 rounded-xl text-sm text-surface-700 hover:text-surface-400 hover:border-white/20 transition-colors">
              + Add Degree
            </button>
          </div>
        </Section>

        {/* Skills */}
        <Section title="Skills">
          <TagInput
            tags={form.skills} inputValue={skillInput} onInputChange={setSkillInput}
            onAdd={() => addToList('skills', skillInput, setSkillInput)}
            onRemove={(i) => removeFromList('skills', i)}
            placeholder="Add a skill and press Enter... (e.g. TypeScript, React, Python)"
          />
        </Section>

        {/* Achievements */}
        <Section title="Key Achievements">
          <p className="text-xs text-surface-700 mb-3">Specific metrics used by the LLM to tailor your resume for each job.</p>
          <TagInput
            tags={form.achievements} inputValue={achievementInput} onInputChange={setAchievementInput}
            onAdd={() => addToList('achievements', achievementInput, setAchievementInput)}
            onRemove={(i) => removeFromList('achievements', i)}
            placeholder='e.g. "Reduced latency by 40% across multi-region deployment" — press Enter'
          />
        </Section>

        {/* Job Search Preferences */}
        <Section title="Job Search Preferences">
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-surface-700 mb-1.5">Target Roles</label>
              <TagInput
                tags={form.targetRoles} inputValue={roleInput} onInputChange={setRoleInput}
                onAdd={() => addToList('targetRoles', roleInput, setRoleInput)}
                onRemove={(i) => removeFromList('targetRoles', i)}
                placeholder='e.g. "Senior Software Engineer" — press Enter'
              />
            </div>
            <div>
              <label className="block text-xs text-surface-700 mb-1.5">Target Locations</label>
              <TagInput
                tags={form.targetLocations} inputValue={locationInput} onInputChange={setLocationInput}
                onAdd={() => addToList('targetLocations', locationInput, setLocationInput)}
                onRemove={(i) => removeFromList('targetLocations', i)}
                placeholder='e.g. "Hyderabad" or "Remote" — press Enter'
              />
            </div>
            <div className="grid grid-cols-3 gap-4 items-end">
              <Input label="Minimum Salary (USD/year)" type="number" value={String(form.minSalary)}
                onChange={(v) => setForm({ ...form, minSalary: Number(v) })} />
              <Toggle label="Remote Only" value={form.remoteOnly}
                onChange={(v) => setForm({ ...form, remoteOnly: v })} />
              <Toggle label="Visa Sponsorship Required" value={form.visaRequired}
                onChange={(v) => setForm({ ...form, visaRequired: v })} />
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-6">
      <h3 className="text-sm font-semibold text-surface-50 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function Input({ label, value, onChange, type = 'text', required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; required?: boolean; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-surface-700 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 transition-colors"
      />
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-surface-700">{label}</label>
      <button onClick={() => onChange(!value)} className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-brand-600' : 'bg-surface-800'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

function TagInput({ tags, inputValue, onInputChange, onAdd, onRemove, placeholder }: {
  tags: string[]; inputValue: string; onInputChange: (v: string) => void
  onAdd: () => void; onRemove: (i: number) => void; placeholder: string
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map((tag, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600/15 text-brand-400 rounded-lg text-xs font-medium">
            {tag}
            <button onClick={() => onRemove(i)} className="text-brand-400/60 hover:text-brand-400 text-sm">×</button>
          </span>
        ))}
      </div>
      <input
        value={inputValue} onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
        placeholder={placeholder}
        className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 transition-colors"
      />
    </div>
  )
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
