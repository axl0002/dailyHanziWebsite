import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { appId, SocialError } from './server'

// Store only a one-way state hash and safe progress labels, never OAuth codes or tokens.
export const attemptId = (state: string) => createHash('sha256').update(state).digest('hex')
export async function beginAttempt(db: SupabaseClient, state: string) {
    const { error } = await db.from('social_instagram_connection_attempts').insert({
        id: attemptId(state), app_id: appId(), status: 'started', stage: 'awaiting_meta',
        message: 'Waiting for Meta to return to Daily Hanzi.',
    })
    if (error) throw new SocialError('Could not start Instagram connection. Check the marketing connection-attempt migration.', 503)
}
export async function updateAttempt(db: SupabaseClient, state: string, stage: string, status = 'processing', message: string | null = null) {
    const { error } = await db.from('social_instagram_connection_attempts').update({
        stage, status, message, updated_at: new Date().toISOString(),
    }).eq('id', attemptId(state)).eq('app_id', appId())
    if (error) throw new SocialError('Could not record Instagram connection progress. Check the marketing database.', 503)
}
