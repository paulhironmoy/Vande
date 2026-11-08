using Vande.Practice.Bridge;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    internal static class CanonicalTraceTestFixture
    {
        public static CanonicalDeliveryTrace Create()
        {
            return new CanonicalDeliveryTrace
            {
                traceVersion = BridgeConstants.TraceVersion,
                deliveryId = "ball-001",
                simulationVersion = BridgeConstants.SimulationVersion,
                durationSeconds = 1.0,
                batterRootOffset = new TraceVector2 { x = 0.06, z = -0.04 },
                batterPosture = new TraceBatterPosture { crouchM = 0.08 },
                batterMotion = new TraceBatterMotion { startT = 0.0, contactT = 0.5, endT = 1.0 },
                ball = new[]
                {
                    new BallTraceSample
                    {
                        t = 0.0,
                        p = Vector(0.0, 0.0, 0.0),
                        v = Vector(1.0, 0.0, 0.0)
                    },
                    new BallTraceSample
                    {
                        t = 1.0,
                        p = Vector(1.0, 0.5, -0.25),
                        v = Vector(1.0, 1.0, 0.0)
                    }
                },
                bat = new[]
                {
                    new BatTraceSample
                    {
                        t = 0.0,
                        grip = Vector(0.0, 1.0, 9.1),
                        toe = Vector(0.0, 0.14, 9.1),
                        face = Vector(0.0, 0.0, 1.0)
                    },
                    new BatTraceSample
                    {
                        t = 0.5,
                        grip = Vector(0.12, 1.1, 9.05),
                        toe = Vector(0.12, 0.24, 9.05),
                        face = Vector(0.0, 0.0, 1.0)
                    },
                    new BatTraceSample
                    {
                        t = 1.0,
                        grip = Vector(0.25, 1.2, 9.0),
                        toe = Vector(0.25, 0.34, 9.0),
                        face = Vector(0.0, 0.0, 1.0)
                    }
                },
                fielders = Fielders(),
                events = new[]
                {
                    new CanonicalTraceEvent
                    {
                        t = 0.0,
                        kind = "release",
                        fielderId = null,
                        p = null
                    },
                    new CanonicalTraceEvent
                    {
                        t = 0.5,
                        kind = "contact",
                        contact = "middle",
                        p = Vector(0.5, 0.25, 0.0)
                    }
                }
            };
        }

        private static FielderTracePath[] Fielders()
        {
            var paths = new FielderTracePath[11];
            for (var index = 0; index < paths.Length; index++)
            {
                paths[index] = new FielderTracePath
                {
                    fielderId = "fielder-" + index,
                    samples = new[]
                    {
                        new FielderTraceSample
                        {
                            t = 0.0,
                            x = index - 5,
                            z = index * 2,
                            action = "idle"
                        },
                        new FielderTraceSample
                        {
                            t = 1.0,
                            x = index - 4.5,
                            z = index * 2 + 0.25,
                            action = index == 2 ? "run" : "idle"
                        }
                    }
                };
            }

            return paths;
        }

        private static TraceVector3 Vector(double x, double y, double z)
        {
            return new TraceVector3 { x = x, y = y, z = z };
        }
    }
}
