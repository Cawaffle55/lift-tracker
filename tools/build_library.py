#!/usr/bin/env python3
"""Build data/exercises.json for Lift Tracker.

Source 1: yuhonas/free-exercise-db (Unlicense / public domain), dist/exercises.json, pinned commit below.
Source 2: SUPPLEMENT below - entries written for Lift Tracker (bodyweight / calisthenics coverage and
          common gym movements missing from the dataset). Also public domain (same terms as the app).
Descriptions for dataset entries are condensed from the dataset's step-by-step instructions.
Usage: python3 tools/build_library.py [path/to/exercises.json]   (downloads it if no path given)
"""
import json, re, sys, urllib.request, os

FEDB_COMMIT = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5"
FEDB_URL = f"https://raw.githubusercontent.com/yuhonas/free-exercise-db/{FEDB_COMMIT}/dist/exercises.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "exercises.json")

EQUIP = {"body only": "bodyweight", None: "bodyweight", "kettlebells": "kettlebell", "bands": "band",
         "e-z curl bar": "ez bar", "foam roll": "foam roller"}
PUSH = {"chest", "shoulders", "triceps"}; PULL = {"lats", "middle back", "biceps", "traps", "forearms", "lower back"}
LEGS = {"quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"}
TIME_RE = re.compile(r"\bplank\b|\bhold\b|wall sit|l-sit|isometric|dead hang|\blever\b|planche|hollow body hold|\bflag\b", re.I)

# Extra search aliases for dataset entries (also used to match program exercise names to the library)
ALIASES = {
 "Barbell Squat": ["Back Squat", "Squat", "High-Bar Squat"], "Barbell Bench Press - Medium Grip": ["Barbell Bench Press", "Bench Press", "Flat Bench Press"],
 "Barbell Deadlift": ["Deadlift", "Conventional Deadlift"], "Pullups": ["Pull-Up", "Pull Up", "Pull-Ups"], "Chin-Up": ["Chin-Ups", "Chinup"],
 "Dips - Chest Version": ["Dip", "Dips", "Chest Dip"], "Dips - Triceps Version": ["Triceps Dip"], "Standing Military Press": ["Overhead Press", "OHP", "Standing Barbell Press", "Military Press"],
 "Close-Grip Barbell Bench Press": ["Close-Grip Bench Press", "CGBP"], "Dumbbell Bicep Curl": ["Dumbbell Curl", "Biceps Curl"], "Tricep Dumbbell Kickback": ["Dumbbell Kickback"],
 "Side Lateral Raise": ["Dumbbell Lateral Raise", "Lateral Raise", "Dumbbell Lateral Raise 21s"], "Leg Extensions": ["Leg Extension", "Eccentric-Accentuated Leg Extension"],
 "Bent-Arm Dumbbell Pullover": ["Dumbbell Pullover"], "Stiff-Legged Dumbbell Deadlift": ["Dumbbell RDL", "Dumbbell Romanian Deadlift"], "Stiff-Legged Barbell Deadlift": ["Stiff-Leg Deadlift", "SLDL"],
 "One-Arm Dumbbell Row": ["Dumbbell Row", "Single-Arm Dumbbell Row"], "Dumbbell Incline Row": ["Incline Dumbbell Row", "Chest-Supported Dumbbell Row"],
 "EZ-Bar Skullcrusher": ["EZ-Bar Skull Crusher", "Skull Crusher", "Eccentric-Accentuated Skull Crusher"], "Cable Rope Overhead Triceps Extension": ["Cable Overhead Triceps Extension", "Overhead Cable Extension", "Cable Overhead Extension"],
 "Triceps Pushdown - Rope Attachment": ["Triceps Rope Pushdown", "Rope Pushdown"], "Triceps Pushdown": ["Triceps Pressdown", "Cable Pushdown"], "Hammer Curls": ["Hammer Curl", "Hammer Cheat Curl"],
 "Cable Hammer Curls - Rope Attachment": ["Rope Hammer Curl"], "Face Pull": ["Rope Face Pull"], "Dumbbell Shrug": ["Incline Dumbbell Shrug"],
 "Wide-Grip Lat Pulldown": ["Lat Pulldown", "Omni-Grip Lat Pulldown", "Machine Pulldown", "Pulldown"], "Machine Shoulder (Military) Press": ["Machine Shoulder Press"],
 "Arnold Dumbbell Press": ["Standing Dumbbell Arnold Press", "Arnold Press"], "Dumbbell Shoulder Press": ["Seated Dumbbell Shoulder Press", "DB Shoulder Press"], "Lying Leg Curls": ["Lying Leg Curl"],
 "Standing Calf Raises": ["Standing Calf Raise", "Machine Calf Raise"], "Calf Press On The Leg Press Machine": ["Leg Press Calf Raise", "Single-Leg Leg Press Calf Raise"],
 "Hyperextensions (Back Extensions)": ["45° Back Extension", "Back Extension", "Prisoner Back Extension"], "Reverse Hyperextension": ["Reverse Hyper"], "Decline Crunch": ["Plate-Weighted Decline Crunch"],
 "Band Assisted Pull-Up": ["Assisted Pull-Up"], "Butterfly": ["Pec Deck", "Machine Fly", "Machine Chest Fly"], "Reverse Machine Flyes": ["Reverse Pec Deck", "Rear Delt Machine Fly"],
 "Cable Rear Delt Fly": ["Reverse Cable Fly"], "Seated Bent-Over Rear Delt Raise": ["Bent-Over Dumbbell Reverse Fly", "Rear Delt Raise"], "Dumbbell Flyes": ["Dumbbell Fly"],
 "Incline Dumbbell Flyes": ["Incline Dumbbell Fly"], "Flat Bench Cable Flyes": ["Cable Chest Fly", "Cable Fly"], "Low Cable Crossover": ["Low-to-High Cable Crossover"],
 "Leverage Chest Press": ["Machine Chest Press"], "Lying T-Bar Row": ["Chest-Supported T-Bar Row"], "Leverage Iso Row": ["Chest-Supported Machine Row", "Chest-Supported Row", "Machine Row"],
 "Seated Cable Rows": ["Seated Cable Row", "Cable Row"], "Bodyweight Walking Lunge": ["Walking Lunge", "Walking Lunges"], "Weighted Sissy Squat": ["Weighted Sissy Squats"],
 "Leg Press": ["Single-Leg Leg Press"], "Barbell Hip Thrust": ["Hip Thrust"], "Standing Biceps Cable Curl": ["Cable Curl"], "Seated Head Harness Neck Resistance": ["Neck Harness", "Neck Flexion/Extension"],
 "Lying Face Up Plate Neck Resistance": ["Plate Neck Curl/Extension"], "Pushups": ["Push-Up", "Push Up", "Push-Ups"], "Bench Dips": ["Chair Dip", "Bench Dip"],
 "Inverted Row": ["Australian Pull-Up", "Bodyweight Row", "Australian Row"], "Plank": ["Front Plank", "Forearm Plank"], "Mountain Climbers": ["Mountain Climber"],
 "Superman": ["Superman Hold"], "Freehand Jump Squat": ["Jump Squat", "Squat Jump"], "Rope Jumping": ["Jump Rope", "Skipping"], "Bodyweight Squat": ["Air Squat"],
 "Handstand Push-Ups": ["Wall Handstand Push-Up", "HSPU"], "Knee Tuck Jump": ["Tuck Jump"], "Plyo Push-up": ["Clap Push-Up", "Clapping Push-Up"], "Muscle Up": ["Muscle-Up", "Bar Muscle-Up"],
 "Hanging Leg Raise": ["Leg Raise"], "One-Arm Kettlebell Swings": ["Kettlebell Swing"], "Thigh Abductor": ["Hip Abduction Machine", "Hip Abduction"], "Thigh Adductor": ["Hip Adduction Machine"],
 "Standing Dumbbell Triceps Extension": ["Dumbbell Overhead Extension", "Dumbbell Overhead Triceps Extension"],
 "Standing Overhead Barbell Triceps Extension": ["EZ-Bar Overhead Extension", "Overhead Barbell Extension"], "Weighted Pull Ups": ["Weighted Pull-Up"],
 "Standing Dumbbell Reverse Curl": ["Dumbbell Reverse Curl", "Dumbbell Reverse Curl → Dumbbell Curl"], "EZ-Bar Curl": ["EZ-Bar Pronated → Supinated Curl", "EZ Curl"],
 "Dumbbell Step Ups": ["Dumbbell Step-Up"], "Barbell Step Ups": ["Barbell Step-Up"], "Seated Calf Raise": ["Seated Calf Raises"], "Romanian Deadlift": ["RDL"],
}

# Hand-written descriptions for the most common lifts (override the condensed dataset text)
DESC = {
 "Barbell Squat": "Bar on your upper back, feet about shoulder width; sit down between your hips to at least parallel, keeping your chest up, then drive back to standing.",
 "Barbell Bench Press - Medium Grip": "Lie on a bench with eyes under the bar, shoulder blades pinched; lower the bar to your mid-chest and press it back up over your shoulders.",
 "Barbell Deadlift": "Bar over mid-foot, hinge down and grip just outside your legs; brace, push the floor away and stand tall with the bar close to your body.",
 "Pullups": "Hang from a bar with an overhand grip slightly wider than your shoulders; pull until your chin clears the bar, then lower to a full hang.",
 "Chin-Up": "Hang with palms facing you about shoulder width apart; pull your chest toward the bar until your chin clears it, then lower fully.",
 "Pushups": "Hands just wider than shoulders, body straight from head to heels; lower your chest to the floor and press back up.",
 "Romanian Deadlift": "Hold the bar at your hips, soften the knees and push your hips back, sliding the bar down your thighs until you feel a hamstring stretch; stand back up.",
 "Standing Military Press": "Bar at shoulder height, grip just outside shoulders; brace your glutes and abs and press the bar straight overhead, moving your head through at the top.",
 "Dumbbell Flyes": "Lie on a flat bench with dumbbells over your chest, elbows slightly bent; open your arms wide in an arc until you feel a chest stretch, then squeeze back up.",
 "Side Lateral Raise": "Stand with dumbbells at your sides; raise them out to shoulder height with a slight elbow bend, leading with the elbows, then lower slowly.",
 "Wide-Grip Lat Pulldown": "Sit with thighs under the pads, grip the bar wide; pull it to your upper chest by driving the elbows down, then let it rise under control.",
 "Leg Press": "Feet shoulder width on the platform; lower the sled until your knees are deeply bent without your lower back rounding, then press back up.",
 "Plank": "Forearms under shoulders and body straight from head to heels; brace your abs and squeeze your glutes and hold without letting the hips sag.",
 "Bodyweight Squat": "Feet shoulder width, arms forward for balance; sit your hips back and down to at least parallel, then stand up through your whole foot.",
 "Dips - Chest Version": "Support yourself on parallel bars, lean your torso forward and lower until your shoulders are below your elbows, then press back up.",
 "Barbell Hip Thrust": "Upper back on a bench, barbell over your hips; drive through your heels to lift your hips until your torso is level, squeeze, and lower.",
 "Iron Cross": "Hold light dumbbells in front of you and raise them out to the sides into a T, keeping arms straight, then lower under control.",
 "One-Arm Kettlebell Swings": "Hinge with a kettlebell in one hand, hike it between your legs and snap your hips forward to swing it to chest height.",
 "Push Press": "Bar in the front rack; dip a few inches at the knees, then drive up explosively and use that momentum to press the bar overhead.",
 "Side Bridge": "Lie on your side propped on one forearm and lift your hips so your body forms a straight line; hold, then switch sides.",
 "Side Jackknife": "Lie on your side and simultaneously lift your legs and crunch your upper body toward them, squeezing the obliques.",
 "Face Pull": "Rope at upper-chest height; pull it toward your face while spreading the ends apart and rotating your hands back, squeezing the rear delts.",
}

# name, equipment, primary, secondary, category, description, tracking ('time' for holds), aliases
S = []
def add(name, eq, pm, sm, cat, desc, tr=None, al=()):
    S.append(dict(name=name, equipment=eq, primary=pm, secondary=sm, category=cat, desc=desc, tracking=tr, aliases=list(al)))
BW = "bodyweight"
# --- bodyweight push
add("Knee Push-Up", BW, ["chest"], ["triceps", "shoulders"], "push", "Push-up from the knees with a straight line from knees to head; lower your chest to the floor and press back up.", al=["Kneeling Push-Up"])
add("Incline Push-Up (Hands Elevated)", BW, ["chest"], ["triceps", "shoulders"], "push", "Hands on a bench, table or wall to make the push-up easier; keep the body rigid and touch your chest to the edge.")
add("Diamond Push-Up", BW, ["triceps"], ["chest", "shoulders"], "push", "Push-up with hands together under your chest, thumbs and index fingers forming a diamond; elbows stay close to your sides.", al=["Close-Grip Push-Up", "Triangle Push-Up"])
add("Wide Push-Up", BW, ["chest"], ["shoulders", "triceps"], "push", "Push-up with hands wider than shoulder width to bias the chest; lower under control until your chest nearly touches.")
add("Pike Push-Up", BW, ["shoulders"], ["triceps"], "push", "Hips high in an inverted V, lower the top of your head toward the floor between your hands, then press back up.")
add("Elevated Pike Push-Up", BW, ["shoulders"], ["triceps"], "push", "Pike push-up with feet on a box or bench so more bodyweight goes through the shoulders; a step toward handstand push-ups.", al=["Feet-Elevated Pike Push-Up"])
add("Archer Push-Up", BW, ["chest"], ["triceps", "shoulders"], "push", "Very wide hands; lower toward one hand while the other arm stays straight, then alternate sides. A progression toward one-arm push-ups.")
add("Pseudo Planche Push-Up", BW, ["shoulders"], ["chest", "triceps"], "push", "Hands by your waist, fingers turned out, lean your shoulders forward past the hands and do push-ups while keeping the lean.")
add("Deficit Push-Up", BW, ["chest"], ["triceps", "shoulders"], "push", "Hands on plates, blocks or push-up handles so your chest can sink below hand level for a deeper stretch.")
add("Hindu Push-Up", BW, ["shoulders"], ["chest", "triceps", "lower back"], "push", "From a downward-dog position swoop your chest low and forward into an upward dog, then push your hips back up.")
add("Spiderman Push-Up", BW, ["chest"], ["abdominals", "triceps"], "push", "As you lower into a push-up, bring one knee toward the same-side elbow; alternate sides each rep.")
add("One-Arm Push-Up", BW, ["chest"], ["triceps", "abdominals"], "push", "Feet wide, one hand under the chest; lower and press with one arm while keeping hips square to the floor.")
add("Ring Push-Up", "other", ["chest"], ["triceps", "shoulders", "abdominals"], "push", "Push-up with hands on gymnastic rings close to the floor; stabilize the rings and turn them out slightly at the top.")
add("Straight Bar Dip", BW, ["chest"], ["triceps", "shoulders"], "push", "Support yourself on a single straight bar, lean slightly forward and dip until the bar is near your chest, then press back to lockout.")
add("Ring Dip", "other", ["triceps"], ["chest", "shoulders"], "push", "Support on rings with arms locked, lower until shoulders are just below elbows while keeping rings close to the body, then press up.", al=["Ring Dips"])
add("Wall Handstand Hold", BW, ["shoulders"], ["triceps", "abdominals"], "skill", "Kick or walk up into a handstand against a wall; push tall through the shoulders, squeeze glutes and hold.", "time", ["Handstand Hold", "Wall Handstand"])
add("Freestanding Handstand", BW, ["shoulders"], ["abdominals", "forearms"], "skill", "Kick up to a handstand without a wall and balance using your fingers; stacked hips over shoulders, body tight.", "time", ["Handstand"])
add("Tuck Planche", BW, ["shoulders"], ["abdominals", "chest"], "skill", "Hands on the floor or parallettes, lean forward and lift both feet with knees tucked to the chest, arms straight. Hold.", "time")
add("Ring Support Hold", "other", ["triceps"], ["shoulders", "chest"], "skill", "Hold yourself above rings with arms locked, rings turned out and body straight.", "time")
add("Crow Pose", BW, ["shoulders"], ["abdominals", "triceps"], "skill", "Squat, place hands on the floor, rest knees on the backs of your upper arms and lean forward until your feet lift. Hold.", "time", ["Crow Stand"])
# --- bodyweight pull
add("Neutral-Grip Pull-Up", BW, ["lats"], ["biceps", "middle back"], "pull", "Pull-up with palms facing each other on parallel handles; pull your chest up toward the handles and lower to a full hang.", al=["Hammer Grip Pull-Up"])
add("Wide-Grip Pull-Up", BW, ["lats"], ["middle back", "biceps"], "pull", "Pull-up with hands well outside shoulder width; drive elbows down and pull your chest toward the bar.")
add("Negative Pull-Up", BW, ["lats"], ["biceps", "middle back"], "pull", "Jump or step to the top of a pull-up, then lower yourself as slowly as possible (3-5 s) to a dead hang.", al=["Eccentric Pull-Up"])
add("Archer Pull-Up", BW, ["lats"], ["biceps"], "pull", "Wide grip; pull toward one hand while the other arm straightens along the bar. Alternate sides.")
add("Commando Pull-Up", BW, ["lats"], ["biceps", "abdominals"], "pull", "Hands close together on the bar, one in front of the other; pull your head to alternate sides of the bar.")
add("L-Sit Pull-Up", BW, ["lats"], ["abdominals", "biceps"], "pull", "Hold your legs straight out in front at hip height while doing strict pull-ups.")
add("Dead Hang", BW, ["forearms"], ["lats", "shoulders"], "pull", "Hang from a bar with straight arms and relaxed shoulders; builds grip strength and decompresses the spine.", "time", ["Bar Hang"])
add("Active Hang", BW, ["lats"], ["forearms", "traps"], "pull", "Hang from the bar and pull the shoulder blades down without bending the elbows. Hold.", "time", ["Scapular Hang"])
add("Doorway Row", BW, ["middle back"], ["biceps", "lats"], "pull", "Grip both sides of a sturdy door frame, lean back with straight arms, then row your chest to the frame. No equipment needed.", al=["Door Frame Row"])
add("Towel Row", BW, ["middle back"], ["biceps", "forearms"], "pull", "Loop a towel around a sturdy post or closed-door handle, lean back holding both ends and row yourself in.")
add("Reverse Snow Angel", BW, ["middle back"], ["shoulders", "lower back"], "pull", "Lie face down, lift your chest and arms slightly and sweep your arms from your hips to overhead and back like a snow angel.")
add("Prone Y-T-W Raise", BW, ["shoulders"], ["middle back", "traps"], "pull", "Face down, lift your arms into a Y, then a T, then a W, squeezing your shoulder blades each time.", al=["Y-T-W"])
add("Front Lever (Tuck)", BW, ["lats"], ["abdominals", "middle back"], "skill", "Hang from a bar, pull your body horizontal with straight arms and knees tucked to the chest. Hold.", "time", ["Tuck Front Lever", "Front Lever"])
add("Back Lever (Tuck)", BW, ["lats"], ["chest", "shoulders", "biceps"], "skill", "From a skin-the-cat position, lower to horizontal facing down with knees tucked and arms straight. Hold.", "time", ["Back Lever"])
add("Skin the Cat", BW, ["lats"], ["shoulders", "abdominals"], "skill", "From a hang, lift legs and rotate backward through your arms as far as comfortable, then return slowly.")
add("Human Flag", BW, ["lats"], ["shoulders", "abdominals"], "skill", "Grip a vertical pole with hands wide, push with the bottom arm and pull with the top to hold your body sideways.", "time")
# --- bodyweight legs
add("Pistol Squat", BW, ["quadriceps"], ["glutes", "hamstrings", "abdominals"], "legs", "Single-leg squat with the other leg held straight out in front; sit all the way down and stand back up on one leg.", al=["Pistol", "Single-Leg Squat"])
add("Assisted Pistol Squat", BW, ["quadriceps"], ["glutes"], "legs", "Pistol squat holding a doorframe, post or band for balance; use as little help as possible.")
add("Shrimp Squat", BW, ["quadriceps"], ["glutes"], "legs", "Stand on one leg, hold the other foot behind you and lower until the back knee touches the floor, then stand up.")
add("Cossack Squat", BW, ["adductors"], ["quadriceps", "glutes"], "legs", "Wide stance; sit down over one leg while the other stays straight with toes up, then shift to the other side.")
add("Bulgarian Split Squat", BW, ["quadriceps"], ["glutes", "hamstrings"], "legs", "Rear foot on a bench behind you, lower straight down until the back knee nears the floor and drive up through the front foot.", al=["Rear-Foot-Elevated Split Squat", "RFESS"])
add("Dumbbell Bulgarian Split Squat", "dumbbell", ["quadriceps"], ["glutes", "hamstrings"], "legs", "Bulgarian split squat holding dumbbells at your sides; keep the torso tall and the front heel planted.")
add("Reverse Lunge", BW, ["quadriceps"], ["glutes", "hamstrings"], "legs", "Step one foot back and lower until both knees are about 90°, then push through the front heel to stand. Alternate legs.", al=["Rear Lunge"])
add("Lateral Lunge", BW, ["adductors"], ["quadriceps", "glutes"], "legs", "Step wide to the side and sit your hips back over that leg, keeping the other leg straight; push back to standing.", al=["Side Lunge"])
add("Curtsy Lunge", BW, ["glutes"], ["quadriceps", "adductors"], "legs", "Step one leg diagonally behind the other like a curtsy and lower; return and alternate.")
add("Jumping Lunge", BW, ["quadriceps"], ["glutes", "calves"], "legs", "From a lunge, jump and switch legs in the air, landing softly in the opposite lunge.", al=["Split Jump Lunge", "Lunge Jump"])
add("Bodyweight Step-Up", BW, ["quadriceps"], ["glutes"], "legs", "Step onto a sturdy box or stair with one foot and stand all the way up, then step down under control.", al=["Step-Up"])
add("Wall Sit", BW, ["quadriceps"], ["glutes"], "legs", "Back flat against a wall, slide down until knees and hips are at 90° and hold.", "time", ["Wall Squat"])
add("Sissy Squat", BW, ["quadriceps"], ["abdominals"], "legs", "Rise onto your toes, lean back and let your knees travel forward as you lower, keeping a straight line from knees to head.", al=["Bodyweight Sissy Squat"])
add("Nordic Ham Curl", BW, ["hamstrings"], ["glutes", "calves"], "legs", "Kneel with ankles anchored and lower your torso forward as slowly as possible using the hamstrings; push off the floor to return.", al=["Nordic Curl", "Nordic Hamstring Curl"])
add("Reverse Nordic", BW, ["quadriceps"], ["abdominals"], "legs", "Kneel upright and lean your whole body back in a straight line from knees to head, then pull back up with the quads.")
add("Glute Bridge", BW, ["glutes"], ["hamstrings", "lower back"], "legs", "Lie on your back with knees bent, drive through your heels to lift your hips until the body is straight, squeeze, and lower.", al=["Bodyweight Glute Bridge", "Hip Bridge"])
add("Single-Leg Hip Thrust", BW, ["glutes"], ["hamstrings"], "legs", "Upper back on a bench, one foot planted; drive the hips up on one leg, squeeze the glute at the top and lower.")
add("Frog Pump", BW, ["glutes"], ["adductors"], "legs", "On your back with the soles of your feet together and knees out, pump your hips up and squeeze the glutes.")
add("Bodyweight Calf Raise", BW, ["calves"], [], "legs", "Stand on the edge of a step, lower your heels for a stretch and rise as high as possible onto your toes.")
add("Single-Leg Calf Raise", BW, ["calves"], [], "legs", "Calf raise on one leg from a step, holding something for balance; full stretch at the bottom, pause at the top.", al=["Single-Leg Standing Calf Raise"])
add("Hip Airplane", BW, ["glutes"], ["hamstrings", "abductors"], "legs", "Hinge forward on one leg, then rotate your pelvis open and closed under control while balancing.")
# --- core
add("Side Plank", BW, ["abdominals"], ["abductors", "shoulders"], "core", "Lie on your side, prop up on your forearm and lift your hips so your body is a straight line. Hold, then switch sides.", "time")
add("Hollow Body Hold", BW, ["abdominals"], ["quadriceps"], "core", "On your back, press your lower back into the floor and lift shoulders and straight legs a few inches off the ground. Hold.", "time", ["Hollow Hold"])
add("Hollow Body Rock", BW, ["abdominals"], [], "core", "From a hollow hold, rock back and forth while keeping the banana-shaped body position.", al=["Hollow Rock"])
add("L-Sit", BW, ["abdominals"], ["quadriceps", "triceps"], "core", "Support yourself on parallettes, dip bars or the floor with straight arms and hold your legs straight out in front at hip height.", "time", ["L-Sit Hold", "Weighted L-Sit Hold", "L-Sit (bodyweight)"])
add("Tuck L-Sit", BW, ["abdominals"], ["triceps"], "core", "Easier L-sit: support on straight arms with knees tucked to the chest and feet off the floor. Hold.", "time")
add("Long-Lever Pelvic Tilt Plank", BW, ["abdominals"], ["glutes"], "core", "Forearm plank with elbows forward under your eyes, glutes squeezed and pelvis tucked under to max out ab tension.", "time", ["RKC Plank"])
add("Copenhagen Plank", BW, ["adductors"], ["abdominals"], "core", "Side plank with the top leg resting on a bench and the bottom leg lifted; hold the line with the inner thigh.", "time")
add("Bear Plank Hold", BW, ["abdominals"], ["shoulders", "quadriceps"], "core", "On hands and toes with knees hovering an inch off the floor, back flat. Hold.", "time", ["Bear Hold"])
add("Bird Dog", BW, ["lower back"], ["abdominals", "glutes"], "core", "On hands and knees, extend the opposite arm and leg until level with your torso, pause, return and alternate.")
add("Hanging Knee Raise", BW, ["abdominals"], ["forearms"], "core", "Hang from a bar and raise your knees toward your chest by curling the pelvis up; lower slowly without swinging.")
add("Toes-to-Bar", BW, ["abdominals"], ["lats", "forearms"], "core", "Hang from a bar and lift straight legs until your toes touch the bar, controlling the descent.", al=["Toes to Bar", "T2B"])
add("V-Up", BW, ["abdominals"], [], "core", "Lying flat, lift your straight legs and torso at the same time to touch your toes at the top, then lower.", al=["V-Ups"])
add("Bicycle Crunch", BW, ["abdominals"], [], "core", "On your back, bring one elbow toward the opposite knee while extending the other leg, alternating in a pedaling motion.")
add("Ab Wheel Rollout", "other", ["abdominals"], ["lats", "shoulders"], "core", "Kneel holding an ab wheel and roll forward as far as you can with a neutral spine, then pull back with the abs.", al=["Ab Roller"])
add("Dragon Flag", BW, ["abdominals"], ["lats", "lower back"], "core", "Lying on a bench gripping behind your head, lift your body to vertical on your shoulders and lower it as a straight line.")
add("Windshield Wiper", BW, ["abdominals"], ["lats"], "core", "Hang or lie with legs raised and rotate them side to side under control like a windshield wiper.", al=["Windshield Wipers"])
add("Plank Shoulder Tap", BW, ["abdominals"], ["shoulders"], "core", "In a high plank, tap each hand to the opposite shoulder without letting the hips rock.")
# --- conditioning / plyometric
add("Burpee", BW, ["quadriceps"], ["chest", "shoulders", "abdominals"], "conditioning", "Squat down, kick your feet back to a plank, do a push-up, jump the feet in and jump up with arms overhead.", al=["Burpees"])
add("Jumping Jack", BW, ["calves"], ["shoulders", "abductors"], "conditioning", "Jump your feet wide while raising arms overhead, then jump back together. Keep a steady rhythm.", al=["Jumping Jacks", "Star Jumps"])
add("High Knees", BW, ["quadriceps"], ["calves", "abdominals"], "conditioning", "Run in place driving your knees to hip height and pumping your arms as quickly as possible.")
add("Butt Kicks", BW, ["hamstrings"], ["calves"], "conditioning", "Jog in place kicking your heels up toward your glutes quickly.")
add("Bear Crawl", BW, ["shoulders"], ["quadriceps", "abdominals"], "conditioning", "On hands and feet with knees hovering low, crawl forward moving opposite hand and foot together.")
add("Crab Walk", BW, ["triceps"], ["glutes", "shoulders"], "conditioning", "Sit with hands behind you, lift hips and walk on hands and feet facing up.")
add("Broad Jump", BW, ["quadriceps"], ["glutes", "hamstrings", "calves"], "conditioning", "Swing your arms and jump forward as far as possible from both feet, landing softly in a squat.", al=["Standing Long Jump"])
add("Skater Jump", BW, ["glutes"], ["quadriceps", "abductors"], "conditioning", "Leap sideways from one leg to the other like a speed skater, landing softly and reaching across.", al=["Skaters"])
add("Squat Thrust", BW, ["quadriceps"], ["shoulders", "abdominals"], "conditioning", "Squat, place hands down, kick feet back to a plank, jump them back in and stand. A burpee without push-up or jump.")
add("Plank Jack", BW, ["abdominals"], ["shoulders", "abductors"], "conditioning", "In a plank, jump your feet wide and back together while keeping hips level.", al=["Plank Jacks"])
add("Shadow Boxing", BW, ["shoulders"], ["abdominals", "calves"], "conditioning", "Throw light, fast punch combinations in the air while moving on the balls of your feet.", "time")
add("Sprawl", BW, ["quadriceps"], ["abdominals", "chest"], "conditioning", "From standing, drop your hands, shoot your legs back with hips low to the floor, then pop back up fast.")
# --- gym movements missing from the dataset
add("Bayesian Cable Curl", "cable", ["biceps"], [], "pull", "Facing away from a low cable, arm slightly behind your body, curl the handle up for a stretched-position biceps curl.")
add("Cable Lateral Raise", "cable", ["shoulders"], [], "push", "Stand beside a low pulley, raise the handle out to the side to shoulder height with a slight elbow bend, then lower slowly.", al=["Single-Arm Cable Lateral Raise", "Cable Lateral Raise 21s"])
add("Egyptian Cable Lateral Raise", "cable", ["shoulders"], [], "push", "Hold an upright post and lean away from it, then do a single-arm cable lateral raise from the low pulley for extra range.")
add("Machine Lateral Raise", "machine", ["shoulders"], [], "push", "Sit in a lateral raise machine with pads on the outside of your arms and raise them out to shoulder height.")
add("Cable Triceps Kickback", "cable", ["triceps"], [], "push", "Hinge forward holding a low cable, upper arm pinned by your side, and extend the elbow fully behind you.")
add("Kneeling Cable Pullover", "cable", ["lats"], ["triceps"], "pull", "Kneel facing a high cable with a rope or bar, arms nearly straight, and sweep the handle down to your thighs.")
add("Pendulum Squat", "machine", ["quadriceps"], ["glutes"], "legs", "Shoulders under the pads of a pendulum squat machine; squat deep with feet mid-platform and drive back up.")
add("Belt Squat", "machine", ["quadriceps"], ["glutes", "adductors"], "legs", "Squat with the load hung from a hip belt so the spine isn't loaded; sit deep and stand tall.")
add("Hip Thrust Machine", "machine", ["glutes"], ["hamstrings"], "legs", "Sit in a hip thrust machine with the pad over your hips and drive your hips up to full extension.")
add("Landmine Press", "barbell", ["shoulders"], ["chest", "triceps"], "push", "Hold the end of a barbell anchored in a landmine at shoulder height and press it up and forward.")
add("Meadows Row", "barbell", ["middle back"], ["lats", "biceps"], "pull", "Stand side-on to a landmine, grip the end of the bar overhand and row it toward your hip with one arm.")
add("Smith Machine Hip Thrust", "smith machine", ["glutes"], ["hamstrings"], "legs", "Upper back on a bench, Smith bar over your hips; drive your hips up to lockout and lower under control.")
add("Seal Row", "barbell", ["middle back"], ["lats", "biceps"], "pull", "Lie face down on a high bench and row a barbell or dumbbells up to the underside of the bench.")
add("Spider Curl", "dumbbell", ["biceps"], [], "pull", "Chest down on an incline bench, arms hanging straight, curl the dumbbells up without moving the upper arms.")
add("Trap Bar Shrug", "other", ["traps"], [], "pull", "Stand inside a trap bar, hold the handles and shrug your shoulders straight up, pausing at the top.")
add("Kettlebell Goblet Squat", "kettlebell", ["quadriceps"], ["glutes"], "legs", "Hold a kettlebell by the horns at your chest and squat between your knees, chest tall.")
add("Band Face Pull", "band", ["shoulders"], ["middle back", "traps"], "pull", "Anchor a band at face height and pull it toward your forehead, spreading your hands apart and rotating out.")
add("Band Lateral Walk", "band", ["abductors"], ["glutes"], "legs", "Band around your knees or ankles, half squat and take steps sideways keeping tension on the band.", al=["Monster Walk"])

def norm(s):
    return " ".join(w[:-1] if w.endswith("s") and len(w) >= 3 and not w.endswith("ss") else w for w in re.sub(r"[^a-z0-9]+", " ", s.lower()).split())

def summarize(steps):
    """Own condensed description: setup sentence from step 1 + movement sentence from the next step."""
    bad = re.compile(r"starting position|^repeat|recommended amount|^tip|^caution|^note|^variation", re.I)
    picks = []
    for st in steps[:3]:
        for sent in re.split(r"(?<=[.!?])\s+", st.strip()):
            sent = sent.strip()
            if sent and not bad.search(sent):
                picks.append(sent); break
        if len(picks) == 2: break
    out = " ".join(picks)
    if len(out) > 230: out = out[:225].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return out

def category(x, pm):
    t = x.get("category")
    if t == "stretching": return "stretch"
    if t == "cardio": return "conditioning"
    if t in ("olympic weightlifting",): return "full body"
    p = pm[0] if pm else ""
    if p in PUSH: return "pull" if (p == "shoulders" and x.get("force") == "pull") else "push"
    if p in PULL: return "pull"
    if p in LEGS: return "legs"
    if p == "abdominals": return "core"
    return "other"

BW_OTHER = {"Dips - Chest Version", "Parallel Bar Dip", "Ring Dips", "Muscle Up", "Kipping Muscle Up", "Gironda Sternum Chins",
            "Mixed Grip Chin", "One Arm Chin-Up", "Side To Side Chins", "One Handed Hang", "Knee/Hip Raise On Parallel Bars",
            "Inverted Row with Straps", "Suspended Push-Up", "Suspended Row", "Suspended Fallout", "Suspended Reverse Crunch",
            "Suspended Split Squat", "Rope Climb", "Box Jump (Multiple Response)", "Front Box Jump", "Lateral Box Jump",
            "Depth Jump Leap", "Linear Depth Jump", "Incline Push-Up Depth Jump", "Single-Leg High Box Squat", "Hyperextensions (Back Extensions)",
            "Bodyweight Mid Row", "Hurdle Hops", "Front Cone Hops (or hurdle hops)", "Lateral Cone Hops", "Skating", "Rope Jumping"}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    data = json.load(open(src)) if src else json.loads(urllib.request.urlopen(FEDB_URL).read())
    lib, seen = [], {}
    for x in data:
        eq = EQUIP.get(x.get("equipment"), x.get("equipment"))
        if re.search(r"\bsmith\b", x["name"], re.I): eq = "smith machine"
        if x["name"] in BW_OTHER: eq = "bodyweight"   # bar / ring / box moves loaded only by bodyweight
        pm, sm = x.get("primaryMuscles") or [], x.get("secondaryMuscles") or []
        e = dict(id=x["id"], name=x["name"], equipment=eq, primary=pm, secondary=sm, category=category(x, pm),
                 type=x.get("category") or "strength", level=x.get("level"), desc=DESC.get(x["name"]) or summarize(x.get("instructions") or []),
                 images=(x.get("images") or [])[:2], source="fedb")
        if x.get("category") == "stretching" or x["name"] == "Side Bridge" or TIME_RE.search(x["name"]): e["tracking"] = "time"
        if x["name"] in ALIASES: e["aliases"] = ALIASES[x["name"]]
        lib.append(e); seen[norm(x["name"])] = e
    missing = set(ALIASES) - {x["name"] for x in data}
    assert not missing, f"aliases for unknown dataset names: {missing}"
    for s in S:
        if norm(s["name"]) in seen: continue
        e = dict(id="lt-" + re.sub(r"[^a-z0-9]+", "-", s["name"].lower()).strip("-"), name=s["name"], equipment=s["equipment"],
                 primary=s["primary"], secondary=s["secondary"], category=s["category"], type="strength", level=None,
                 desc=s["desc"], images=[], source="lift-tracker")
        if s["tracking"]: e["tracking"] = s["tracking"]
        if s["aliases"]: e["aliases"] = s["aliases"]
        lib.append(e); seen[norm(s["name"])] = e
    # drop empty/None keys to keep the payload small
    lib = [{k: v for k, v in e.items() if v not in (None, [], "")} for e in lib]
    lib.sort(key=lambda e: e["name"].lower())
    meta = dict(version=1, count=len(lib), imageBase=f"https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@{FEDB_COMMIT}/exercises/",
                sources=[dict(name="free-exercise-db by yuhonas", url="https://github.com/yuhonas/free-exercise-db", license="Unlicense (public domain)", commit=FEDB_COMMIT),
                         dict(name="Lift Tracker additions", license="public domain")])
    json.dump(dict(meta=meta, exercises=lib), open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    print(len(lib), "exercises,", sum(1 for e in lib if e["equipment"] == "bodyweight"), "bodyweight,", os.path.getsize(OUT) // 1024, "KB")

if __name__ == "__main__":
    main()
