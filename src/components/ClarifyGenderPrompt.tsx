// "Is Mark Berzins your son-in-law or your daughter-in-law?" — the one-tap fix for a relationship
// the app can only half-name (founder request, 2026-08-05).
//
// The relationship calculator words everything from `people.gender`, and falls back to a genderless
// noun when it isn't on file. For blood relations that fallback is ordinary English ("parent",
// "cousin"), but for the in-law and aunt/uncle positions there IS no natural genderless word, so it
// lands on "child-in-law" / "aunt/uncle" — which is what the founder saw and (rightly) disliked.
//
// Asked as a relationship question rather than "what gender is this person?": the founder is looking
// at a family tree, not a database, and the two answers ARE the two words the tile could show. What
// it saves is still just the gender field, so answering here also lights up the ♂/♀ tile glyph and
// every other place that person is described.

import { colors, fontSize, space } from '../lib/theme'
import { styles as bannerStyles } from './RelationshipSuggestions'

export type GenderQuestion = {
  personId: string
  personName: string
  /** "your" when the tree is centered on the account holder, otherwise "Harvey's". */
  possessive: string
  /** The same relationship worded both ways — see genderAlternatives in relationshipCalculator.ts. */
  male: string
  female: string
}

// "son-in-law" → "Son-in-law". Only the first letter: "Daughter-in-law" must not become
// "Daughter-In-Law", and "1st cousin once removed" must keep its lowercase tail.
function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function ClarifyGenderPrompt({
  question,
  onAnswer,
  onSkip,
  saving = false,
}: {
  question: GenderQuestion
  onAnswer: (personId: string, gender: 'male' | 'female') => void
  onSkip: (personId: string) => void
  saving?: boolean
}) {
  return (
    <div style={bannerStyles.suggestBanner}>
      <span>
        Is {question.personName} {question.possessive} <strong>{question.male}</strong> or{' '}
        <strong>{question.female}</strong>?
      </span>
      <span style={styles.why}>
        Grove doesn't know yet, so it's using a vaguer word for {question.personName} everywhere it
        describes them.
      </span>
      <div style={bannerStyles.suggestButtonRow}>
        <button
          type="button"
          onClick={() => onAnswer(question.personId, 'male')}
          disabled={saving}
          style={bannerStyles.suggestYesButton}
        >
          {sentenceCase(question.male)}
        </button>
        <button
          type="button"
          onClick={() => onAnswer(question.personId, 'female')}
          disabled={saving}
          style={bannerStyles.suggestYesButton}
        >
          {sentenceCase(question.female)}
        </button>
        <button
          type="button"
          onClick={() => onSkip(question.personId)}
          disabled={saving}
          style={bannerStyles.suggestNoButton}
        >
          Skip
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  why: { fontSize: fontSize.small, color: colors.suggest, marginTop: `-${space.xs}` },
}
