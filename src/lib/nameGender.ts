// First-name → likely gender, so the app stops asking about the obvious ones (founder, 2026-08-05:
// "Mark is obviously a man's name"). This was in item 44's original spec and deferred then; the
// clarify prompt is what made it worth doing, because a prompt that asks about every Mark and Susan
// in a 400-person tree is worse than no prompt at all.
//
// HOW THE 75% THRESHOLD IS EXPRESSED. The founder asked to only be asked when the app is less than
// ~75% sure. Rather than attach an invented probability to each name — a made-up 0.87 would look
// like evidence while being nothing of the kind — confidence is expressed as list membership:
// MALE/FEMALE hold names that are lopsided enough in ordinary English/US usage to sail past that
// bar, AMBIGUOUS holds the ones that look decidable but aren't, and anything absent is unknown. Both
// "ambiguous" and "absent" mean the same thing to callers: don't assume, ask.
//
// This NEVER writes to the database. A guess wears off the moment a real gender is recorded, and a
// wrong guess is one dropdown away from being fixed — whereas a guessed value saved into someone's
// record would be indistinguishable from a fact the founder actually stated.

export type GenderGuess = 'male' | 'female' | null

// Names that read decisively male/female in ordinary US/English usage. Weighted toward the
// generations that actually populate this app's trees — the founder's own family runs to
// great-grandparents, so Mildred and Herman matter as much as Harper and Mason.
const MALE = new Set([
  'aaron', 'abel', 'abraham', 'adam', 'adrian', 'alan', 'albert', 'alberto', 'alejandro', 'alexander',
  'alfred', 'alfredo', 'allen', 'alvin', 'andre', 'andres', 'andrew', 'anthony', 'antonio', 'arnold',
  'arthur', 'austin', 'barry', 'benjamin', 'bernard', 'bill', 'billy', 'bob', 'bobby', 'brad',
  'bradley', 'brandon', 'brendan', 'brent', 'brett', 'brian', 'bruce', 'bryan', 'byron', 'caleb',
  'calvin', 'carl', 'carlos', 'cesar', 'chad', 'charles', 'chester', 'christian', 'christopher',
  'clarence', 'claude', 'clayton', 'clifford', 'clifton', 'clint', 'clyde', 'cody', 'colin', 'conor',
  'connor', 'conrad', 'corey', 'cornelius', 'craig', 'curtis', 'damon', 'dan', 'daniel', 'danny',
  'darrell', 'darren', 'darryl', 'dave', 'david', 'dean', 'dennis', 'derek', 'derrick', 'dominic',
  'don', 'donald', 'donnie', 'doug', 'douglas', 'duane', 'dustin', 'dwayne', 'dwight', 'dylan',
  'earl', 'ed', 'eddie', 'edgar', 'edmund', 'eduardo', 'edward', 'edwin', 'elmer', 'emilio',
  'enrique', 'eric', 'erik', 'ernest', 'ernesto', 'ethan', 'eugene', 'evan', 'everett', 'felix',
  'fernando', 'floyd', 'forrest', 'francis', 'francisco', 'frank', 'franklin', 'fred', 'freddie',
  'frederick', 'gabriel', 'garrett', 'gary', 'gene', 'geoffrey', 'george', 'gerald', 'gerard',
  'gilbert', 'glen', 'glenn', 'gordon', 'grant', 'greg', 'gregory', 'harold', 'harry', 'harvey',
  'hector', 'henry', 'herbert', 'herman', 'homer', 'horace', 'howard', 'hugh', 'hugo', 'ian',
  'ignacio', 'irving', 'isaac', 'isaiah', 'ivan', 'jack', 'jacob', 'james', 'jared', 'jason',
  'javier', 'jay', 'jeff', 'jeffery', 'jeffrey', 'jeremy', 'jerome', 'jerry', 'jesse', 'jesus',
  'jim', 'jimmy', 'joe', 'joel', 'joey', 'john', 'johnny', 'jon', 'jonathan', 'jorge', 'jose',
  'joseph', 'joshua', 'juan', 'julian', 'julio', 'justin', 'keith', 'ken', 'kenneth', 'kenny',
  'kent', 'kevin', 'kirk', 'kurt', 'kyle', 'lamar', 'lance', 'larry', 'lawrence', 'leo', 'leon',
  'leonard', 'leroy', 'lester', 'levi', 'lewis', 'lloyd', 'logan', 'lonnie', 'louis', 'lowell',
  'lucas', 'luis', 'luke', 'luther', 'malcolm', 'manuel', 'marc', 'marcos', 'marcus', 'mario',
  'mark', 'marlon', 'marshall', 'martin', 'marvin', 'mason', 'mathew', 'matt', 'matthew', 'maurice',
  'max', 'maxwell', 'melvin', 'micah', 'michael', 'micheal', 'miguel', 'mike', 'miles', 'milton',
  'mitchell', 'morris', 'moses', 'murray', 'myron', 'nathan', 'nathaniel', 'neal', 'neil', 'nelson',
  'nicholas', 'nick', 'nicolas', 'noah', 'norman', 'oliver', 'omar', 'orlando', 'orville', 'oscar',
  'otis', 'owen', 'pablo', 'patrick', 'paul', 'pedro', 'percy', 'perry', 'pete', 'peter', 'phil',
  'philip', 'phillip', 'pierre', 'preston', 'quentin', 'rafael', 'ralph', 'ramon', 'randall',
  'randy', 'raul', 'ray', 'raymond', 'reginald', 'rex', 'ricardo', 'richard', 'rick', 'ricky',
  'robert', 'roberto', 'rodney', 'roger', 'roland', 'rolando', 'ron', 'ronald', 'ronnie', 'roosevelt',
  'rory', 'ross', 'roy', 'ruben', 'rudolph', 'rudy', 'russell', 'rusty', 'ryan', 'salvador',
  'samuel', 'santiago', 'saul', 'scott', 'sean', 'sergio', 'seth', 'shane', 'shaun', 'shawn',
  'sheldon', 'sherman', 'silas', 'simon', 'solomon', 'spencer', 'stanley', 'stephen', 'steve',
  'steven', 'stewart', 'stuart', 'sylvester', 'ted', 'terrance', 'terrence', 'theodore', 'thomas',
  'tim', 'timothy', 'tobias', 'toby', 'todd', 'tom', 'tommy', 'tony', 'travis', 'trevor', 'troy',
  'tyler', 'tyrone', 'ulysses', 'vernon', 'victor', 'vicente', 'vincent', 'virgil', 'wade',
  'wallace', 'walter', 'warren', 'wayne', 'wendell', 'wesley', 'wilbur', 'will', 'willard',
  'william', 'willie', 'willis', 'wilson', 'winston', 'woodrow', 'zachary', 'zane',
])

const FEMALE = new Set([
  'abigail', 'ada', 'adela', 'adriana', 'agnes', 'aileen', 'alberta', 'alexandra', 'alice', 'alicia',
  'alina', 'alison', 'allison', 'alma', 'amanda', 'amber', 'amelia', 'amy', 'ana', 'anastasia',
  'andrea', 'angela', 'angelica', 'angelina', 'anita', 'ann', 'anna', 'annabelle', 'anne', 'annette',
  'annie', 'antoinette', 'april', 'arlene', 'ashley', 'audrey', 'aurora', 'autumn', 'ava', 'barbara',
  'beatrice', 'becky', 'belinda', 'bernadette', 'bernice', 'bertha', 'bessie', 'beth', 'bethany',
  'betty', 'beulah', 'beverly', 'bianca', 'blanche', 'bonnie', 'brenda', 'briana', 'brianna',
  'bridget', 'brittany', 'brooke', 'camila', 'camille', 'candace', 'candice', 'cara', 'carla',
  'carmen', 'carol', 'carole', 'caroline', 'carolyn', 'carrie', 'cassandra', 'catherine', 'cathy',
  'cecelia', 'cecilia', 'celeste', 'celia', 'charlene', 'charlotte', 'chelsea', 'cheryl', 'chloe',
  'christina', 'christine', 'christy', 'cindy', 'claire', 'clara', 'clarice', 'claudia', 'colleen',
  'connie', 'constance', 'cora', 'corinne', 'courtney', 'cristina', 'crystal', 'cynthia', 'daisy',
  'danielle', 'daphne', 'darlene', 'dawn', 'deanna', 'debbie', 'deborah', 'debra', 'delia',
  'delores', 'denise', 'diana', 'diane', 'dianne', 'dolores', 'donna', 'dora', 'doreen', 'doris',
  'dorothy', 'edith', 'edna', 'eileen', 'elaine', 'eleanor', 'elena', 'elisa', 'elisabeth',
  'elizabeth', 'ella', 'ellen', 'eloise', 'elsie', 'elvira', 'emily', 'emma', 'erica', 'erika',
  'erin', 'esperanza', 'estelle', 'esther', 'ethel', 'eunice', 'eva', 'evelyn', 'faith', 'fannie',
  'faye', 'felicia', 'fiona', 'flora', 'florence', 'frances', 'francine', 'freda', 'gabriela',
  'gabrielle', 'gail', 'genevieve', 'georgia', 'geraldine', 'gertrude', 'gina', 'ginger', 'gladys',
  'glenda', 'gloria', 'grace', 'gracie', 'greta', 'gwen', 'gwendolyn', 'hannah', 'harriet',
  'hazel', 'heather', 'heidi', 'helen', 'helena', 'henrietta', 'hilda', 'holly', 'hope', 'ida',
  'imogene', 'ines', 'irene', 'iris', 'irma', 'isabel', 'isabella', 'isabelle', 'ivy', 'jacqueline',
  'jane', 'janelle', 'janet', 'janice', 'janie', 'jasmine', 'jean', 'jeanette', 'jeanne', 'jenna',
  'jennie', 'jennifer', 'jenny', 'jessica', 'jill', 'joan', 'joann', 'joanna', 'joanne', 'jocelyn',
  'johanna', 'josephine', 'joy', 'joyce', 'juanita', 'judith', 'judy', 'julia', 'julie', 'juliet',
  'june', 'karen', 'karla', 'kate', 'katherine', 'kathleen', 'kathryn', 'kathy', 'katie', 'katrina',
  'kay', 'kayla', 'keisha', 'kelsey', 'kendra', 'kimberly', 'kirsten', 'krista', 'kristen',
  'kristin', 'kristina', 'kristine', 'krystal', 'lana', 'larissa', 'latoya', 'laura', 'lauren',
  'laurie', 'laverne', 'leah', 'lena', 'leona', 'leticia', 'lidia', 'lila', 'lillian', 'lillie',
  'lily', 'linda', 'lindsay', 'lindsey', 'lisa', 'liz', 'lois', 'lola', 'loretta', 'lori',
  'lorraine', 'louise', 'lucia', 'lucille', 'lucinda', 'lucy', 'luz', 'lydia', 'mabel', 'madeline',
  'madison', 'mae', 'maggie', 'mamie', 'mandy', 'marcia', 'margaret', 'margarita', 'marguerite',
  'maria', 'mariah', 'marian', 'marianne', 'maribel', 'marie', 'marilyn', 'marisa', 'marisol',
  'marissa', 'marjorie', 'marlene', 'marsha', 'martha', 'mary', 'maryann', 'matilda', 'maureen',
  'mavis', 'maxine', 'maya', 'megan', 'meghan', 'melanie', 'melinda', 'melissa', 'melody',
  'mercedes', 'meredith', 'mia', 'michele', 'michelle', 'mildred', 'millie', 'mindy', 'minnie',
  'miranda', 'miriam', 'misty', 'mollie', 'molly', 'mona', 'monica', 'monique', 'muriel', 'myra',
  'myrtle', 'nadine', 'nancy', 'naomi', 'natalie', 'natasha', 'nellie', 'nichole', 'nicole',
  'nikki', 'nina', 'noelle', 'nora', 'norma', 'olga', 'olive', 'olivia', 'opal', 'ophelia', 'pam',
  'pamela', 'patricia', 'patsy', 'patti', 'paula', 'paulette', 'pauline', 'pearl', 'peggy', 'penny',
  'phyllis', 'priscilla', 'rachel', 'ramona', 'raquel', 'rebecca', 'regina', 'renee', 'rhonda',
  'rita', 'roberta', 'rochelle', 'rosa', 'rosalie', 'rosalind', 'rose', 'rosemary', 'rosie',
  'roxanne', 'ruby', 'ruth', 'sabrina', 'sadie', 'sallie', 'sally', 'samantha', 'sandra', 'sara',
  'sarah', 'savannah', 'selena', 'serena', 'sharon', 'sheila', 'shelly', 'sherri', 'sherry',
  'shirley', 'sofia', 'sonia', 'sonya', 'sophia', 'sophie', 'stacey', 'stacy', 'stella',
  'stephanie', 'sue', 'susan', 'susana', 'susie', 'suzanne', 'sybil', 'sylvia', 'tabitha', 'tamara',
  'tammy', 'tanya', 'tara', 'tasha', 'teresa', 'teri', 'terri', 'thelma', 'theresa', 'tiffany',
  'tina', 'toni', 'tonya', 'trina', 'trisha', 'ursula', 'valerie', 'vanessa', 'velma', 'vera',
  'verna', 'veronica', 'vicki', 'vickie', 'vicky', 'victoria', 'viola', 'violet', 'virginia',
  'vivian', 'wanda', 'wendy', 'whitney', 'wilma', 'yolanda', 'yvette', 'yvonne', 'zelda', 'zoe',
])

// Checked FIRST, and deliberately overlapping nothing above. These are the names that feel decidable
// and aren't — either genuinely split in usage (Jordan, Casey, Riley), or split across languages
// (Angel, Andrea, Jose-vs-Josie style confusions). Getting one of these wrong is exactly the failure
// the founder would notice, so they always fall through to the question.
const AMBIGUOUS = new Set([
  'alex', 'alexis', 'angel', 'aubrey', 'avery', 'bailey', 'billie', 'blair', 'blake', 'bobbie',
  'cameron', 'campbell', 'carey', 'carroll', 'casey', 'charlie', 'chris', 'dakota', 'dale', 'dana',
  'darcy', 'devin', 'devon', 'dominique', 'drew', 'ellis', 'emerson', 'finley', 'frankie', 'gale',
  'harley', 'harper', 'hayden', 'hollis', 'jackie', 'jaime', 'jamie', 'jess', 'jo', 'jody', 'jordan',
  'jules', 'kai', 'kelly', 'kendall', 'kerry', 'kim', 'lane', 'lee', 'leigh', 'leslie', 'loren',
  'lynn', 'marion', 'mel', 'merle', 'montana', 'morgan', 'nat', 'noel', 'ollie', 'parker', 'pat',
  'payton', 'peyton', 'phoenix', 'quinn', 'reagan', 'reese', 'regan', 'remy', 'rene', 'riley',
  'river', 'robin', 'rowan', 'sage', 'sam', 'sandy', 'sasha', 'sawyer', 'shea', 'shelby', 'sidney',
  'skylar', 'skyler', 'sloan', 'stevie', 'sydney', 'taylor', 'terry', 'tracey', 'tracy', 'val',
])

// Exported for supabase/functions/_shared/nameGender.test.ts, which asserts these are identical to
// the edge-function mirror's copies. Nothing else should read them — callers want the guess, not the
// lists behind it.
export const _SETS = { MALE, FEMALE, AMBIGUOUS }

// Accents dropped so "José" matches "jose"; anything that isn't a letter, hyphen or apostrophe is
// stripped so a stray initial ("J.") or a quoted nickname doesn't defeat the lookup.
function normalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[^a-zA-Z'-]/g, '')
    .toLowerCase()
}

/**
 * A confident guess at someone's gender from their first name, or null when the app should ask
 * instead. Pure and synchronous — safe to call per person while building a graph.
 *
 * Takes a full name or a bare first name; only the first word is ever consulted, since `people.name`
 * already holds the first name with the surname in its own column.
 */
export function guessGenderFromName(name: string | null | undefined): GenderGuess {
  if (!name) return null
  const [firstWord] = name.trim().split(/\s+/)
  if (!firstWord) return null

  const whole = normalize(firstWord)
  if (whole.length < 2) return null
  if (AMBIGUOUS.has(whole)) return null
  if (MALE.has(whole)) return 'male'
  if (FEMALE.has(whole)) return 'female'

  // A hyphenated compound is decided by BOTH halves, not just the leading one. Reading only the
  // first half turns Jean-Pierre into a woman — the halves have to agree, or the name goes back in
  // the "ask me" pile where it belongs.
  const parts = whole.split('-').filter((p) => p.length >= 2)
  if (parts.length < 2) return null
  const found = new Set<GenderGuess>()
  for (const part of parts) {
    if (AMBIGUOUS.has(part)) return null
    if (MALE.has(part)) found.add('male')
    else if (FEMALE.has(part)) found.add('female')
  }
  return found.size === 1 ? [...found][0] : null
}
