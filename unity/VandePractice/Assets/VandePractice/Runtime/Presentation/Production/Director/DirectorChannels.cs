namespace Vande.Practice.Presentation.Production.Director
{
    /// <summary>
    /// The Director's channels: what <see cref="DirectorCore.Sample(DirectorPlan, double, float[], int)"/> writes each frame (a C# port of channels.ts, contract
    /// director/3). Angles are degrees in the actor's role frame (the world axes turned so that +z is down the pitch
    /// towards the opponent): yaw + turns left, pitch + looks down (leans forward), roll + tilts to the right shoulder.
    /// A trace stores each channel as an Int16: stored = clamp(round(value / Scale[c]), -32767, 32767).
    /// </summary>
    public static class DirectorChannels
    {
        /// <summary>'space' mode (what the stage uses): the head in space, soft-limited to 62 / 40 / 12 degrees. 'overlay' mode (tests): degrees to add to the clip's head.</summary>
        public const int HeadYaw = 0;
        public const int HeadPitch = 1;
        public const int HeadRoll = 2;
        /// <summary>Eyes in the head (deg); written in 'overlay' mode only (in 'space' mode the stage takes the eyes from the gaze and the head it drew).</summary>
        public const int EyeYawL = 3;
        public const int EyePitchL = 4;
        public const int EyeYawR = 5;
        public const int EyePitchR = 6;
        /// <summary>Lids: 0 open ... 1 closed, one per eye.</summary>
        public const int BlinkL = 7;
        public const int BlinkR = 8;
        /// <summary>Upper lid follows vertical gaze (-1 .. 1); 'overlay' mode only.</summary>
        public const int LidFollow = 9;
        /// <summary>'space' mode: the raw gaze (gaze + microsaccades + eye drift). 'overlay': head + eyes as achieved.</summary>
        public const int GazeYaw = 10;
        public const int GazePitch = 11;
        /// <summary>Chest swing (deg), + inhale. Zero in the quiet windows and in Reduced Motion.</summary>
        public const int Breath = 12;
        /// <summary>Root shift across the pitch (mm), + to the actor's left; includes the weight-shift and stance fidgets; gated.</summary>
        public const int SwayX = 13;
        /// <summary>Root shift along the pitch (mm), + toward the opponent; gated.</summary>
        public const int SwayZ = 14;
        /// <summary>Hips roll (deg), + to the right; gated.</summary>
        public const int SwayRoll = 15;
        /// <summary>0 .. 1.5: raises the breath rate and depth; not gated by the quiet windows.</summary>
        public const int Exertion = 16;
        /// <summary>The five expression weights (0..1); zero below detail 2. XEffort is never in a plan: the stage adds it from the batter's own swing.</summary>
        public const int XConcentration = 17;
        public const int XEffort = 18;
        public const int XFrustration = 19;
        public const int XRelief = 20;
        public const int XCelebration = 21;
        /// <summary>Trunk posture (deg), + lifts the chest, - drops the shoulders; fidgets and the reaction; gated.</summary>
        public const int Posture = 22;
        /// <summary>Upper-body twist about the vertical (deg), + to the left; fidgets; gated.</summary>
        public const int Twist = 23;

        /// <summary>Channels per frame.</summary>
        public const int Count = 24;

        /// <summary>Units per Int16 step for each channel (range = 32767 steps). All powers of two, so value / Scale is exact.</summary>
        public static readonly double[] Scale =
        {
            1d / 512, 1d / 512, 1d / 512, // head: +-64 deg
            1d / 512, 1d / 512, 1d / 512, 1d / 512, // eyes: +-64 deg
            1d / 16384, 1d / 16384, 1d / 16384, // lids: +-2
            1d / 128, 1d / 128, // gaze: +-256 deg
            1d / 4096, 1d / 1024, 1d / 1024, 1d / 4096, 1d / 8192, // breath deg, sway mm, sway mm, roll deg, exertion
            1d / 16384, 1d / 16384, 1d / 16384, 1d / 16384, 1d / 16384, // expressions
            1d / 4096, 1d / 4096, // posture deg, twist deg
        };
    }
}
