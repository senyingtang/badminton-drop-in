'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import VenueForm from '@/components/venues/VenueForm'
import CourtManager from '@/components/venues/CourtManager'
import styles from './venue-detail.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VenueRow = any

export default function VenueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const [venue, setVenue] = useState<VenueRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchVenue = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('venues')
        .select('*, courts(*)')
        .eq('id', id)
        .single()

      if (error) console.error(error)
      else setVenue(data)
      setLoading(false)
    }

    fetchVenue()
  }, [id, supabase])

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>載入場館中...</p>
      </div>
    )
  }

  if (!venue) {
    return (
      <div className={styles.notFound}>
        <h3>找不到此場館</h3>
        <Link href="/venues" className="btn btn-ghost">
          返回場館列表
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <Link href="/venues" className={styles.backLink}>← 返回</Link>
          <h1 className={styles.title}>{venue.name}</h1>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.left}>
          <VenueForm initialData={venue} />
        </div>
        <div className={styles.right}>
          <CourtManager venueId={venue.id} initialCourts={venue.courts || []} />
        </div>
      </div>
    </div>
  )
}
