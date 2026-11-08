VANDE INTERFACE AND CRICKET-ASSET CONSTITUTION

This constitution is binding on every VANDE Practice screen, component, animation and visual asset.

If another requirement conflicts with this constitution, this constitution controls the interface and visual presentation.

The objective is not to fit every available feature onto the screen. The objective is to preserve concentration, make cricket understandable and create a premium experience in which the interface disappears when the player needs to read the ball.

PART I — INTERFACE CONSTITUTION

1. ONE SCREEN, ONE PURPOSE

Every screen must have one primary purpose.

Examples:

Launch:
Choose Practice.

Practice menu:
Choose Random or Predefined Over.

Setup:
Understand and confirm the session.

Live delivery:
Observe and play the ball.

Dead ball:
Understand the result.

Coach Mode:
Learn and retry the delivery.

Summary:
Understand progress and choose what to do next.

Do not combine setup, coaching, progression, promotion and gameplay into one screen.

2. ONE PRIMARY ACTION

Every screen may contain:

- One visually dominant primary action
- One secondary action where genuinely necessary
- Quiet navigation or disclosure controls

Do not show several equal-weight buttons.

Do not use:

- Feature grids
- Promotional carousels
- Animated banners
- Reward buttons
- Currency counters
- Streak indicators
- Multiple competing calls to action
- Persistent notification dots
- Pulsing buttons
- Fake urgency
- Decorative badges

3. THE BALL OUTRANKS THE INTERFACE

During a live delivery, the priority order is:

1. Ball
2. Bowler and release
3. Pitch and bounce
4. Batter control
5. Field awareness
6. Score and equation
7. Everything else

No UI element may cover or visually compete with the bowler, release hand, pitch area, ball path, bat or contact zone.

4. DELIVERY QUIET MODE

When the bowler begins the approach, automatically enter Delivery Quiet Mode.

In this state:

- Freeze all HUD animation
- Reduce nonessential UI contrast
- Hide coaching and instructional copy
- Close no panel automatically over gameplay
- Stop decorative motion
- Do not display notifications
- Do not update progression
- Do not show rewards
- Do not move the camera
- Do not play interface sounds

Only a quiet peripheral rail remains:

- Score
- Over and ball
- Chase equation when applicable
- Wickets
- Compact field radar
- Compact conditions indicator
- Pause control

After the ball becomes dead, restore normal prominence.

5. MANDATORY INFORMATION WITHOUT CLUTTER

The user has requested that setup information remain available throughout play.

Implement this through a compact persistent information rail—not a permanent dashboard.

Collapsed rail:

- Pitch icon and name
- Ball condition
- Bowler family and arm
- Assistance level
- Compact field radar

One tap expands the complete setup without leaving the innings.

Expanded setup:

- Pitch behavior
- Ball condition and age
- Bowler profile
- Pace band or spin type
- Known bowling pattern information
- Full field with labels
- Training objective
- Assistance settings

In Random Over, never reveal the exact upcoming delivery.

6. CONTEXTUAL DISCLOSURE

Display information only when it becomes useful.

Before the over:
- Conditions
- Bowler
- Field
- Objective

During the ball:
- Minimal peripheral information

After the ball:
- Result
- Updated score
- Delivery information
- One primary coaching insight

Inside “Why?”:
- Full physics and technical explanation

Inside Coach Mode:
- Alternative responses
- Ghost footwork
- Bat path
- Contact zone
- Field analysis

Do not display advanced diagnostics by default.

7. TYPOGRAPHY

Create a restrained typography system with no more than:

- Display
- Screen title
- Section title
- Body
- Caption/numerical label

Require:

- Tabular numerals for score and speed
- Strong contrast
- Consistent line height
- Short lines
- No text embedded in raster images
- Correct Indic-script fonts
- Dynamic text scaling
- No all-caps paragraphs
- All caps reserved for very short cricket outcomes such as FOUR, SIX or OUT

Copy must be short and direct.

Prefer:

“38 ms early”

over:

“You appear to have played the shot somewhat earlier than the recommended timing window.”

8. SPACING AND ALIGNMENT

Use an eight-point spacing system.

Every screen must use consistent:

- Margins
- Vertical rhythm
- Card radius
- Control height
- Icon sizing
- Alignment
- Safe-area treatment

Elements should align to a limited number of visual axes.

Do not place components wherever space happens to remain.

9. COLOR

Use a restrained semantic palette:

- Near-black or deep stadium background
- Warm white primary text
- One VANDE brand accent
- Green for confirmed success or control
- Amber for pressure or caution
- Red only for dismissal, danger or destructive actions
- Neutral grey for secondary information

Do not assign arbitrary colors to every feature.

Field, pitch, uniforms and crowd may be visually rich. The interface itself remains restrained.

10. MATERIALS AND SURFACES

Do not imitate Apple by adding glass effects everywhere.

Use translucent or blurred surfaces only when they:

- Preserve awareness of the match behind a temporary panel
- Maintain text readability
- Clearly communicate depth

Avoid:

- Nested translucent panels
- Excessive gradients
- Glowing borders
- Permanent floating cards
- Heavy drop shadows
- Multiple background materials on one screen

11. MOTION

Every animation must serve one of four purposes:

- Explain navigation
- Confirm input
- Communicate state change
- Express a meaningful cricket consequence

Motion must be:

- Interruptible
- Short
- Physically coherent
- Consistent
- Disabled or reduced through Reduced Motion

No idle animation may compete with a live delivery.

Four and six celebrations begin only after the boundary is physically confirmed. Wicket presentation begins only after the dismissal is confirmed.

12. HAPTICS

Use haptics sparingly:

- Bowler release: optional, very subtle
- Bat contact: proportional to contact quality
- Edge: distinct, light
- Stump impact: sharp
- Close call: restrained
- Four: confirmation
- Six: stronger confirmation
- Wicket: decisive
- Coach mastery: restrained success

Do not vibrate for navigation, decorative animation or routine score updates.

13. SOUND

Interface sounds remain secondary to cricket sound.

Priority:

1. Ball release
2. Pitch contact
3. Bat contact
4. Ball trajectory and fielding
5. Player calls
6. Crowd
7. Commentary
8. Interface

Do not cover the contact sound with music, commentary or celebration.

14. COACH MODE HIERARCHY

The post-ball coaching screen shows only:

OUTCOME
What happened

PRIMARY REASON
Why it happened

RECOMMENDATION
What to change

PRIMARY ACTION
Practice this ball

Secondary disclosure:
Why?
Alternative shots
Watch demonstration

Do not display every measurement simultaneously.

15. ERROR AND RECOVERY DESIGN

Errors must be calm and actionable.

Never show raw technical language.

Examples:

“Your innings is safe.”
“Practice will continue when the game resumes.”
“This device is switching to Classic graphics for smoother batting.”

A crash, pause or orientation change must not produce a technical loss.

16. UI ADDITION RULE

Before adding any persistent UI element, answer:

- What exact decision does this help the player make?
- At what moment is it needed?
- Can it appear only at that moment?
- Can an existing component communicate it?
- Does it distract from the ball?
- What can be removed or consolidated to make room?

If these questions cannot be answered, do not add the element.

17. INTERFACE ACCEPTANCE

A screen fails if:

- Users cannot identify the primary action in two seconds
- The ball is visually obscured
- More than one element demands immediate attention
- Animation continues during the delivery without purpose
- Setup information is inaccessible
- The user must remember information from a previous screen
- Advanced data appears before its relevance is understood
- Text truncates at supported sizes or languages
- A feature exists solely because it may improve engagement metrics

PART II — CRICKET-ASSET CONSTITUTION

18. ASSET QUALITY REGISTER

Create an asset register containing:

- Asset name
- Purpose
- Source
- Licence
- Original or third-party status
- Polygon count
- Texture resolution
- Material count
- LOD levels
- Animation requirements
- Low/medium/high variants
- Compressed source bytes and Android installed-byte contribution for each delivered device variant
- Memory cost
- Load cost
- Visual acceptance status
- Physical-device verification status

Do not ship unidentified, unlicensed or placeholder assets.

19. PLAYER ASSETS

Create original professional-quality cricketers with:

BODY
- Credible anatomy
- Natural posture
- Correct scale
- Hand and finger structure
- Proper grip
- Natural running and weight transfer

FACE
- Original identity
- Clear eyes, nose, mouth, jaw and ears
- Natural skin tone and roughness
- Eyebrows, hair and facial-hair variation
- Blinking and eye focus
- Concentration, effort, frustration, relief and celebration expressions

CLOTHING
- Original jersey
- Trousers
- Undershirt where appropriate
- Fabric weave
- Stitching
- Collar
- Creases and movement
- Dirt and sweat progression
- Original player name and number if shown

No real-player likenesses, team kits, sponsors or trademarks without licences.

20. BATTER EQUIPMENT

Provide:

- Helmet shell
- Realistically proportioned metal grill
- Helmet padding and chin strap
- Cap option
- Batting gloves with finger sections and palm material
- Batting pads with rolls, knee protection and rear straps
- Thigh guard
- Arm guard
- Optional chest protection where appropriate
- Abdominal protection implied without unnecessary visualization
- Cricket shoes with soles and spikes
- Bat with willow grain, edges, toe, grip and wear

Equipment must move with the body without clipping.

21. BOWLER AND FIELDER EQUIPMENT

Provide:

- Original fielding uniforms
- Cricket shoes
- Caps and sun hats
- Optional sunglasses for appropriate conditions
- Sweat and dirt variation
- Ball-polishing animation
- Credible catching and throwing hand placement

22. WICKETKEEPER

Provide a distinct wicketkeeper with:

- Keeper gloves
- Inner gloves where visible
- Wicketkeeping pads
- Helmet or cap based on position
- Correct crouch
- Lateral movement
- Collection
- Stumping
- Appeal and reaction

Do not reuse a generic fielder animation for wicketkeeping.

23. OFFICIALS

Provide original umpires with:

- Neutral original clothing
- Correct field positions
- Boundary signals
- Six signal
- Out signal
- Not-out response
- Wide/no-ball architecture for later rules
- Calm idle behavior

Umpires must never obstruct the batter’s view.

24. BAT

Require:

- Correct dimensions
- Willow grain
- Face, edge, spine and toe
- Handle wrapping
- Grip texture
- Original decal
- Wear, scuffs and ball marks
- Accurate sweet spot
- Bat-face orientation visible in Coach Mode

Do not use real equipment branding.

25. BALL

Require:

- Correct scale
- Raised stitched seam
- Polished side
- Rough side
- Scuffing and aging
- Red and white original variants
- Physically consistent rotation
- Seam orientation tied to simulation
- Shine orientation tied to swing
- Readable highlights without artificial glowing

Provide a training close-up that clearly shows seam, shine and roughness.

26. WICKETS

Require:

- Correct stump spacing and dimensions
- Crease placement
- Wood grain or original tournament finish
- Separate physical bails
- Believable stump flex and bail release
- Clear impact response
- Optional original illuminated-bail variant

27. FIELD AND GROUND

Require:

- Distinct Balanced, Green, Hard & Bouncy and Turning surfaces
- Grass blades or convincing texture treatment
- Worn crease
- Bowler footmarks
- Cracks and rough areas
- Correct pitch dimensions
- Visible crease markings
- Outfield mowing pattern
- Boundary rope
- Ball boys or ground details only when performance permits
- Correct ball roll and bounce response

Pitch visuals must correspond to actual physics.

28. STADIUM

Provide:

- Sight screens
- Boundary
- Advertising structures with original fictional content
- Pavilion
- Player area or dugout
- Dressing-room entrance
- Scoreboard
- Floodlights where appropriate
- Seating tiers
- Entrances and aisles
- Railings and barriers
- Camera platforms
- Original flags and banners
- Correct field scale

The sight screen must improve ball visibility.

29. CROWD

The crowd must not be a static repeated texture on capable devices.

Use scalable crowd tiers:

LOW
- Sparse instanced spectators
- Limited movement
- Simplified materials

MEDIUM
- Increased density
- Regional color variation
- Group reactions
- Standing and sitting states

HIGH
- Greater variation in faces, clothing and behavior
- Localized reactions near the ball
- Waves of standing spectators
- Banners and flags
- Visible anticipation, celebration and disappointment

Avoid obvious repeated clones.

Crowd movement must follow the emotion observer, not random constant animation.

30. ENVIRONMENT

Support:

- Day
- Late afternoon
- Evening under lights
- Clear and lightly overcast conditions

Require:

- Correct shadows
- Believable sky
- Exposure that preserves ball visibility
- Appropriate stadium lighting
- Subtle atmospheric depth
- No dramatic lighting that prevents reading the delivery

31. DETAIL VERSUS PERFORMANCE

Close-up quality and gameplay quality have different budgets.

Use high-detail assets for:

- Setup
- Player introduction
- Dead-ball reaction
- Coach replay
- Result

Use optimized LODs for:

- Live delivery
- Distant fielders
- Crowd
- Stadium background

Visual quality must never compromise:

- Ball visibility
- Input latency
- Stable frame rate
- Thermal performance
- Memory safety
- The 50,000,000-byte Android fresh-installed ceiling or the 90% India working-reach gate

32. ASSET ACCEPTANCE TESTS

Every major asset must pass:

- Close-up screenshot
- Gameplay-distance screenshot
- Low/medium/high comparison
- Day/evening lighting
- Left/right-handed presentation
- No visible clipping
- Correct physical scale
- Correct shadow behavior
- Acceptable memory cost
- Measured Android installed-size delta on the exact release artifact
- Low-tier Android performance
- Licence verification

Reject an asset if it is technically complete but visually weak.

FINAL CONSTITUTIONAL STANDARD

The interface should feel quiet, inevitable and precise.

The cricket world should feel detailed, human and alive.

The interface must never compete with the match.

The assets must never look like placeholders.

The player should remember the ball, the decision and the outcome—not the menu used to reach them.
