import { describe, it, expect } from 'vitest'
import { clusterPoints, projectToPixels, type MapPoint } from './mapClusters'

const DENVER = { latitude: 39.7392, longitude: -104.9903 }
const PARKER = { latitude: 39.5186, longitude: -104.7614 }
const LONDON = { latitude: 51.5074, longitude: -0.1278 }

function point(coords: { latitude: number; longitude: number }, item: string): MapPoint<string> {
  return { ...coords, item }
}

describe('projectToPixels', () => {
  it('puts 0,0 at the centre of the world square', () => {
    const size = 256 * 2 ** 3
    expect(projectToPixels(0, 0, 3)).toEqual({ x: size / 2, y: size / 2 })
  })

  it('grows the world by a factor of two per zoom level', () => {
    const near = projectToPixels(39.7392, -104.9903, 4)
    const far = projectToPixels(39.7392, -104.9903, 5)
    expect(far.x).toBeCloseTo(near.x * 2, 6)
    expect(far.y).toBeCloseTo(near.y * 2, 6)
  })

  it('clamps the poles instead of projecting them to infinity', () => {
    const northPole = projectToPixels(90, 0, 4)
    expect(Number.isFinite(northPole.y)).toBe(true)
    expect(northPole.y).toBeLessThan(projectToPixels(0, 0, 4).y)
  })
})

describe('clusterPoints', () => {
  it('returns nothing for no points', () => {
    expect(clusterPoints([], 4)).toEqual([])
  })

  it('keeps a lone point as its own cluster, at its own coordinates', () => {
    const [only] = clusterPoints([point(DENVER, 'a')], 10)
    expect(only.items).toEqual(['a'])
    expect(only.latitude).toBeCloseTo(DENVER.latitude, 10)
    expect(only.longitude).toBeCloseTo(DENVER.longitude, 10)
  })

  // The whole reason this module exists: at world zoom the founder's Denver-heavy account has to
  // collapse to one pin, and zooming in has to take it apart again.
  it('merges neighbours when zoomed out and separates them when zoomed in', () => {
    const points = [point(DENVER, 'denver'), point(PARKER, 'parker')]

    const zoomedOut = clusterPoints(points, 3)
    expect(zoomedOut).toHaveLength(1)
    expect(zoomedOut[0].items.sort()).toEqual(['denver', 'parker'])

    const zoomedIn = clusterPoints(points, 12)
    expect(zoomedIn).toHaveLength(2)
  })

  it('never merges points on different continents', () => {
    const clusters = clusterPoints([point(DENVER, 'denver'), point(LONDON, 'london')], 4)
    expect(clusters).toHaveLength(2)
  })

  it('places a cluster at the average of its members', () => {
    const [merged] = clusterPoints([point(DENVER, 'a'), point(PARKER, 'b')], 3)
    expect(merged.latitude).toBeCloseTo((DENVER.latitude + PARKER.latitude) / 2, 10)
    expect(merged.longitude).toBeCloseTo((DENVER.longitude + PARKER.longitude) / 2, 10)
  })

  it('keeps every point exactly once, however they group', () => {
    const points = [
      point(DENVER, 'a'),
      point(PARKER, 'b'),
      point(LONDON, 'c'),
      point(DENVER, 'd'),
    ]
    for (const zoom of [1, 4, 8, 14]) {
      const items = clusterPoints(points, zoom).flatMap((c) => c.items)
      expect(items.sort()).toEqual(['a', 'b', 'c', 'd'])
    }
  })

  it('orders biggest cluster first so pin keys stay stable', () => {
    const clusters = clusterPoints(
      [point(LONDON, 'lone'), point(DENVER, 'a'), point(DENVER, 'b')],
      6
    )
    expect(clusters.map((c) => c.items.length)).toEqual([2, 1])
  })

  // Bucketing is stable by construction; assert it, because a distance-based rewrite would quietly
  // break it and the symptom (pins twitching while you drag) is easy to mistake for a render bug.
  it('does not depend on the order points arrive in', () => {
    const points = [point(DENVER, 'a'), point(PARKER, 'b'), point(LONDON, 'c')]
    const forwards = clusterPoints(points, 5)
    const backwards = clusterPoints([...points].reverse(), 5)
    expect(backwards.map((c) => [...c.items].sort())).toEqual(forwards.map((c) => [...c.items].sort()))
  })
})
