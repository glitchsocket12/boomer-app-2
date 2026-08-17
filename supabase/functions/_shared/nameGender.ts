// Edge-function mirror of src/lib/nameGender.ts. Deno can't import across the Vite boundary, so this
// is a hand-maintained copy in the same pattern as kinship.ts, relationshipsTable.ts and
// familyRoster.ts. nameGender.test.ts compares the three name sets and every lookup result across
// BOTH copies, so drift fails the suite rather than quietly letting the AI call someone's brother
// their sister.
//
// WHY THE MODEL NEEDS THIS AT ALL (founder, 2026-08-16: the app "still is asking 'is this his
// mother?' when her name is clearly a woman's name"). The browser already fills gender gaps from
// first names when it builds the family graph, which is why the family TREE says "husband" and
// "stepmother" — but nothing gendered ever reached the Edge Functions. Every family fact the model
// was handed came through genderless: "parents: A, B", "siblings: C, D", "A + B — children: …". So
// the model could not say "his mother" even about a Margaret, and asked instead. Same guess, same
// never-written-to-the-database rule, now on both sides of the boundary.
//
// See the browser copy for the full reasoning on the 75% threshold and the three-set design.

export type GenderGuess = "male" | "female" | null

const MALE = new Set([
  "aaron", "abel", "abraham", "adam", "adrian", "alan", "albert", "alberto", "alejandro", "alexander",
  "alfred", "alfredo", "allen", "alvin", "andre", "andres", "andrew", "anthony", "antonio", "arnold",
  "arthur", "austin", "barry", "benjamin", "bernard", "bill", "billy", "bob", "bobby", "brad",
  "bradley", "brandon", "brendan", "brent", "brett", "brian", "bruce", "bryan", "byron", "caleb",
  "calvin", "carl", "carlos", "cesar", "chad", "charles", "chester", "christian", "christopher",
  "clarence", "claude", "clayton", "clifford", "clifton", "clint", "clyde", "cody", "colin", "conor",
  "connor", "conrad", "corey", "cornelius", "craig", "curtis", "damon", "dan", "daniel", "danny",
  "darrell", "darren", "darryl", "dave", "david", "dean", "dennis", "derek", "derrick", "dominic",
  "don", "donald", "donnie", "doug", "douglas", "duane", "dustin", "dwayne", "dwight", "dylan",
  "earl", "ed", "eddie", "edgar", "edmund", "eduardo", "edward", "edwin", "elmer", "emilio",
  "enrique", "eric", "erik", "ernest", "ernesto", "ethan", "eugene", "evan", "everett", "felix",
  "fernando", "floyd", "forrest", "francis", "francisco", "frank", "franklin", "fred", "freddie",
  "frederick", "gabriel", "garrett", "gary", "gene", "geoffrey", "george", "gerald", "gerard",
  "gilbert", "glen", "glenn", "gordon", "grant", "greg", "gregory", "harold", "harry", "harvey",
  "hector", "henry", "herbert", "herman", "homer", "horace", "howard", "hugh", "hugo", "ian",
  "ignacio", "irving", "isaac", "isaiah", "ivan", "jack", "jacob", "james", "jared", "jason",
  "javier", "jay", "jeff", "jeffery", "jeffrey", "jeremy", "jerome", "jerry", "jesse", "jesus",
  "jim", "jimmy", "joe", "joel", "joey", "john", "johnny", "jon", "jonathan", "jorge", "jose",
  "joseph", "joshua", "juan", "julian", "julio", "justin", "keith", "ken", "kenneth", "kenny",
  "kent", "kevin", "kirk", "kurt", "kyle", "lamar", "lance", "larry", "lawrence", "leo", "leon",
  "leonard", "leroy", "lester", "levi", "lewis", "lloyd", "logan", "lonnie", "louis", "lowell",
  "lucas", "luis", "luke", "luther", "malcolm", "manuel", "marc", "marcos", "marcus", "mario",
  "mark", "marlon", "marshall", "martin", "marvin", "mason", "mathew", "matt", "matthew", "maurice",
  "max", "maxwell", "melvin", "micah", "michael", "micheal", "miguel", "mike", "miles", "milton",
  "mitchell", "morris", "moses", "murray", "myron", "nathan", "nathaniel", "neal", "neil", "nelson",
  "nicholas", "nick", "nicolas", "noah", "norman", "oliver", "omar", "orlando", "orville", "oscar",
  "otis", "owen", "pablo", "patrick", "paul", "pedro", "percy", "perry", "pete", "peter", "phil",
  "philip", "phillip", "pierre", "preston", "quentin", "rafael", "ralph", "ramon", "randall",
  "randy", "raul", "ray", "raymond", "reginald", "rex", "ricardo", "richard", "rick", "ricky",
  "robert", "roberto", "rodney", "roger", "roland", "rolando", "ron", "ronald", "ronnie", "roosevelt",
  "rory", "ross", "roy", "ruben", "rudolph", "rudy", "russell", "rusty", "ryan", "salvador",
  "samuel", "santiago", "saul", "scott", "sean", "sergio", "seth", "shane", "shaun", "shawn",
  "sheldon", "sherman", "silas", "simon", "solomon", "spencer", "stanley", "stephen", "steve",
  "steven", "stewart", "stuart", "sylvester", "ted", "terrance", "terrence", "theodore", "thomas",
  "tim", "timothy", "tobias", "toby", "todd", "tom", "tommy", "tony", "travis", "trevor", "troy",
  "tyler", "tyrone", "ulysses", "vernon", "victor", "vicente", "vincent", "virgil", "wade",
  "wallace", "walter", "warren", "wayne", "wendell", "wesley", "wilbur", "will", "willard",
  "william", "willie", "willis", "wilson", "winston", "woodrow", "zachary", "zane",
])

const FEMALE = new Set([
  "abigail", "ada", "adela", "adriana", "agnes", "aileen", "alberta", "alexandra", "alice", "alicia",
  "alina", "alison", "allison", "alma", "amanda", "amber", "amelia", "amy", "ana", "anastasia",
  "andrea", "angela", "angelica", "angelina", "anita", "ann", "anna", "annabelle", "anne", "annette",
  "annie", "antoinette", "april", "arlene", "ashley", "audrey", "aurora", "autumn", "ava", "barbara",
  "beatrice", "becky", "belinda", "bernadette", "bernice", "bertha", "bessie", "beth", "bethany",
  "betty", "beulah", "beverly", "bianca", "blanche", "bonnie", "brenda", "briana", "brianna",
  "bridget", "brittany", "brooke", "camila", "camille", "candace", "candice", "cara", "carla",
  "carmen", "carol", "carole", "caroline", "carolyn", "carrie", "cassandra", "catherine", "cathy",
  "cecelia", "cecilia", "celeste", "celia", "charlene", "charlotte", "chelsea", "cheryl", "chloe",
  "christina", "christine", "christy", "cindy", "claire", "clara", "clarice", "claudia", "colleen",
  "connie", "constance", "cora", "corinne", "courtney", "cristina", "crystal", "cynthia", "daisy",
  "danielle", "daphne", "darlene", "dawn", "deanna", "debbie", "deborah", "debra", "delia",
  "delores", "denise", "diana", "diane", "dianne", "dolores", "donna", "dora", "doreen", "doris",
  "dorothy", "edith", "edna", "eileen", "elaine", "eleanor", "elena", "elisa", "elisabeth",
  "elizabeth", "ella", "ellen", "eloise", "elsie", "elvira", "emily", "emma", "erica", "erika",
  "erin", "esperanza", "estelle", "esther", "ethel", "eunice", "eva", "evelyn", "faith", "fannie",
  "faye", "felicia", "fiona", "flora", "florence", "frances", "francine", "freda", "gabriela",
  "gabrielle", "gail", "genevieve", "georgia", "geraldine", "gertrude", "gina", "ginger", "gladys",
  "glenda", "gloria", "grace", "gracie", "greta", "gwen", "gwendolyn", "hannah", "harriet",
  "hazel", "heather", "heidi", "helen", "helena", "henrietta", "hilda", "holly", "hope", "ida",
  "imogene", "ines", "irene", "iris", "irma", "isabel", "isabella", "isabelle", "ivy", "jacqueline",
  "jane", "janelle", "janet", "janice", "janie", "jasmine", "jean", "jeanette", "jeanne", "jenna",
  "jennie", "jennifer", "jenny", "jessica", "jill", "joan", "joann", "joanna", "joanne", "jocelyn",
  "johanna", "josephine", "joy", "joyce", "juanita", "judith", "judy", "julia", "julie", "juliet",
  "june", "karen", "karla", "kate", "katherine", "kathleen", "kathryn", "kathy", "katie", "katrina",
  "kay", "kayla", "keisha", "kelsey", "kendra", "kimberly", "kirsten", "krista", "kristen",
  "kristin", "kristina", "kristine", "krystal", "lana", "larissa", "latoya", "laura", "lauren",
  "laurie", "laverne", "leah", "lena", "leona", "leticia", "lidia", "lila", "lillian", "lillie",
  "lily", "linda", "lindsay", "lindsey", "lisa", "liz", "lois", "lola", "loretta", "lori",
  "lorraine", "louise", "lucia", "lucille", "lucinda", "lucy", "luz", "lydia", "mabel", "madeline",
  "madison", "mae", "maggie", "mamie", "mandy", "marcia", "margaret", "margarita", "marguerite",
  "maria", "mariah", "marian", "marianne", "maribel", "marie", "marilyn", "marisa", "marisol",
  "marissa", "marjorie", "marlene", "marsha", "martha", "mary", "maryann", "matilda", "maureen",
  "mavis", "maxine", "maya", "megan", "meghan", "melanie", "melinda", "melissa", "melody",
  "mercedes", "meredith", "mia", "michele", "michelle", "mildred", "millie", "mindy", "minnie",
  "miranda", "miriam", "misty", "mollie", "molly", "mona", "monica", "monique", "muriel", "myra",
  "myrtle", "nadine", "nancy", "naomi", "natalie", "natasha", "nellie", "nichole", "nicole",
  "nikki", "nina", "noelle", "nora", "norma", "olga", "olive", "olivia", "opal", "ophelia", "pam",
  "pamela", "patricia", "patsy", "patti", "paula", "paulette", "pauline", "pearl", "peggy", "penny",
  "phyllis", "priscilla", "rachel", "ramona", "raquel", "rebecca", "regina", "renee", "rhonda",
  "rita", "roberta", "rochelle", "rosa", "rosalie", "rosalind", "rose", "rosemary", "rosie",
  "roxanne", "ruby", "ruth", "sabrina", "sadie", "sallie", "sally", "samantha", "sandra", "sara",
  "sarah", "savannah", "selena", "serena", "sharon", "sheila", "shelly", "sherri", "sherry",
  "shirley", "sofia", "sonia", "sonya", "sophia", "sophie", "stacey", "stacy", "stella",
  "stephanie", "sue", "susan", "susana", "susie", "suzanne", "sybil", "sylvia", "tabitha", "tamara",
  "tammy", "tanya", "tara", "tasha", "teresa", "teri", "terri", "thelma", "theresa", "tiffany",
  "tina", "toni", "tonya", "trina", "trisha", "ursula", "valerie", "vanessa", "velma", "vera",
  "verna", "veronica", "vicki", "vickie", "vicky", "victoria", "viola", "violet", "virginia",
  "vivian", "wanda", "wendy", "whitney", "wilma", "yolanda", "yvette", "yvonne", "zelda", "zoe",
])

const AMBIGUOUS = new Set([
  "alex", "alexis", "angel", "aubrey", "avery", "bailey", "billie", "blair", "blake", "bobbie",
  "cameron", "campbell", "carey", "carroll", "casey", "charlie", "chris", "dakota", "dale", "dana",
  "darcy", "devin", "devon", "dominique", "drew", "ellis", "emerson", "finley", "frankie", "gale",
  "harley", "harper", "hayden", "hollis", "jackie", "jaime", "jamie", "jess", "jo", "jody", "jordan",
  "jules", "kai", "kelly", "kendall", "kerry", "kim", "lane", "lee", "leigh", "leslie", "loren",
  "lynn", "marion", "mel", "merle", "montana", "morgan", "nat", "noel", "ollie", "parker", "pat",
  "payton", "peyton", "phoenix", "quinn", "reagan", "reese", "regan", "remy", "rene", "riley",
  "river", "robin", "rowan", "sage", "sam", "sandy", "sasha", "sawyer", "shea", "shelby", "sidney",
  "skylar", "skyler", "sloan", "stevie", "sydney", "taylor", "terry", "tracey", "tracy", "val",
])

// Exported for nameGender.test.ts, which asserts these are byte-identical to the browser copy's.
// Nothing else should read them — callers want the guess, not the lists behind it.
export const _SETS = { MALE, FEMALE, AMBIGUOUS }

function normalize(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[^a-zA-Z'-]/g, "")
    .toLowerCase()
}

/**
 * A confident guess at someone's gender from their first name, or null when the app should ask
 * instead. Pure and synchronous — safe to call per person while building a roster.
 */
export function guessGenderFromName(name: string | null | undefined): GenderGuess {
  if (!name) return null
  const [firstWord] = name.trim().split(/\s+/)
  if (!firstWord) return null

  const whole = normalize(firstWord)
  if (whole.length < 2) return null
  if (AMBIGUOUS.has(whole)) return null
  if (MALE.has(whole)) return "male"
  if (FEMALE.has(whole)) return "female"

  const parts = whole.split("-").filter((p) => p.length >= 2)
  if (parts.length < 2) return null
  const found = new Set<GenderGuess>()
  for (const part of parts) {
    if (AMBIGUOUS.has(part)) return null
    if (MALE.has(part)) found.add("male")
    else if (FEMALE.has(part)) found.add("female")
  }
  return found.size === 1 ? [...found][0] : null
}

/**
 * The gender to USE for someone: what's actually recorded, else what the first name suggests, else
 * null. Recorded always wins — including a recorded 'non-binary' or 'other', which must never be
 * overridden by whatever a first name reads like. Same precedence as the browser's loadFamilyGraph.
 */
export function effectiveGender(recorded: string | null | undefined, name: string | null | undefined): string | null {
  if (recorded) return recorded
  return guessGenderFromName(name)
}
