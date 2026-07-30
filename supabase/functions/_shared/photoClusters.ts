// Groups a freshly-imported batch of Google Photos into date-based clusters and proposes a
// matching existing event for each, so PhotoImportReview.tsx can offer "new event" or "add to
// {existing event}" per cluster. Deliberately no AI call — a picked photo's only real signal is
// its own timestamp (Google's baseUrl download strips location Exif, see google-photos-picker-
// session-import), so this is a plain date-gap/overlap heuristic, same "free, no-AI" spirit as
// ImportReview.tsx's client-side duplicate-detection heuristic.

// A new cluster starts once consecutive photos (sorted by taken_at) are more than this many days
// apart — long enough to keep a single day's outing together, short enough not to blend two
// separate weekend trips a few weeks apart into one cluster.
const GAP_DAYS = 2

export interface ClusterablePhoto {
  id: string
  takenAt: string | null // ISO timestamp, from mediaMetadata.creationTime
}

export interface ExistingMoment {
  id: string
  eventDate: string | null // date, "YYYY-MM-DD"
  eventEndDate: string | null
}

export interface PhotoCluster {
  photoIds: string[]
  dateRangeStart: string | null // date, "YYYY-MM-DD"
  dateRangeEnd: string | null
  matchedMomentId: string | null
}

function toDateOnly(iso: string): string {
  return iso.slice(0, 10)
}

export function clusterPhotosByDate(photos: ClusterablePhoto[], existingMoments: ExistingMoment[]): PhotoCluster[] {
  const dated = photos.filter((p) => p.takenAt).sort((a, b) => a.takenAt!.localeCompare(b.takenAt!))
  const undated = photos.filter((p) => !p.takenAt)

  const clusters: PhotoCluster[] = []
  let current: ClusterablePhoto[] = []

  const flush = () => {
    if (current.length === 0) return
    const start = toDateOnly(current[0].takenAt!)
    const end = toDateOnly(current[current.length - 1].takenAt!)
    clusters.push({
      photoIds: current.map((p) => p.id),
      dateRangeStart: start,
      dateRangeEnd: end,
      matchedMomentId: findMatchingMoment(start, end, existingMoments),
    })
    current = []
  }

  for (const photo of dated) {
    if (current.length === 0) {
      current.push(photo)
      continue
    }
    const prev = current[current.length - 1]
    const gapMs = new Date(photo.takenAt!).getTime() - new Date(prev.takenAt!).getTime()
    const gapDays = gapMs / (1000 * 60 * 60 * 24)
    if (gapDays > GAP_DAYS) {
      flush()
    }
    current.push(photo)
  }
  flush()

  // Photos with no timestamp at all (rare) can't be date-clustered or matched — group them
  // together as a single undated cluster rather than guessing.
  if (undated.length > 0) {
    clusters.push({
      photoIds: undated.map((p) => p.id),
      dateRangeStart: null,
      dateRangeEnd: null,
      matchedMomentId: null,
    })
  }

  return clusters
}

// Picks the existing moment whose own date range overlaps the cluster's, preferring the
// narrowest (most specific) match when more than one overlaps.
function findMatchingMoment(start: string, end: string, moments: ExistingMoment[]): string | null {
  let best: { id: string; span: number } | null = null
  for (const moment of moments) {
    if (!moment.eventDate) continue
    const momentStart = moment.eventDate
    const momentEnd = moment.eventEndDate ?? moment.eventDate
    const overlaps = momentStart <= end && momentEnd >= start
    if (!overlaps) continue
    const span = new Date(momentEnd).getTime() - new Date(momentStart).getTime()
    if (!best || span < best.span) {
      best = { id: moment.id, span }
    }
  }
  return best?.id ?? null
}
