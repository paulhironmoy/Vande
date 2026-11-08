using System;
using System.Collections.Generic;
using System.Reflection;
using System.Reflection.Emit;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// An IL scan for the instructions that allocate on the heap, for code that calls the engine (the Director's stage binding and head pass): a
    /// class being constructed, an array, a boxing, a delegate being made. Value types being constructed (Vector3, Quaternion, the stage's structs) are not
    /// allocations. The methods of the Director's own namespaces are followed; calls into the engine's math and transform accessors, the BCL's math
    /// and the delegate invoke are known not to allocate; any other call out is reported.
    /// </summary>
    internal static class StageAllocationScan
    {
        private static readonly Dictionary<short, OpCode> OpCodesByValue = BuildOpCodes();

        private static Dictionary<short, OpCode> BuildOpCodes()
        {
            var one = new Dictionary<short, OpCode>();
            foreach (FieldInfo f in typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                var op = (OpCode)f.GetValue(null);
                one[op.Value] = op;
            }
            return one;
        }

        /// <summary>Extra rules a test may add for one scan (and must take off again): calls that are not allocations on the path being scanned, and calls to follow.</summary>
        internal static Func<MethodBase, bool> ExtraQuiet;
        internal static Func<MethodBase, bool> ExtraFollow;

        private static bool Quiet(MethodBase callee)
        {
            Type owner = callee.DeclaringType;
            if (owner == null) return false;
            if (ExtraQuiet != null && ExtraQuiet(callee)) return true;
            if (owner == typeof(Math) || owner == typeof(double) || owner == typeof(float) || owner == typeof(int) || owner == typeof(long)) return true;
            if (owner.IsGenericType && owner.GetGenericTypeDefinition() == typeof(Nullable<>)) return true;
            if (typeof(Delegate).IsAssignableFrom(owner) && callee.Name == "Invoke") return true;
            string ns = owner.Namespace ?? "";
            if (ns == "UnityEngine")
            {
                switch (owner.Name)
                {
                    case "Quaternion":
                    case "Vector3":
                    case "Mathf":
                        return true;
                    case "Transform":
                        return callee.Name.StartsWith("get_") || callee.Name.StartsWith("set_");
                    case "GameObject":
                        return callee.Name == "get_transform";
                }
            }
            if (ns == "System.Diagnostics" && owner.Name == "Stopwatch") return true;
            if (ns == "System.Collections.Generic" && owner.Name.StartsWith("List`") && (callee.Name == "get_Item" || callee.Name == "get_Count" || callee.Name == "Remove" || callee.Name == "Contains")) return true;
            return false;
        }

        public static void Scan(MethodBase m, HashSet<MethodBase> seen, List<string> found)
        {
            if (m == null) throw new ArgumentNullException(nameof(m));
            if (!seen.Add(m)) return;
            MethodBody body = m.GetMethodBody();
            if (body == null) return;
            byte[] il = body.GetILAsByteArray();
            int i = 0;
            while (i < il.Length)
            {
                OpCode op;
                if (il[i] == 0xFE)
                {
                    op = OpCodesByValue[(short)(0xFE00 | il[i + 1])];
                    i += 2;
                }
                else
                {
                    op = OpCodesByValue[il[i]];
                    i += 1;
                }
                int operandAt = i;
                switch (op.OperandType)
                {
                    case OperandType.InlineNone: break;
                    case OperandType.ShortInlineBrTarget:
                    case OperandType.ShortInlineI:
                    case OperandType.ShortInlineVar: i += 1; break;
                    case OperandType.InlineVar: i += 2; break;
                    case OperandType.InlineI8:
                    case OperandType.InlineR: i += 8; break;
                    case OperandType.InlineSwitch: i += 4 + 4 * BitConverter.ToInt32(il, i); break;
                    default: i += 4; break;
                }
                string where = m.DeclaringType.Name + "." + m.Name;
                if (op == OpCodes.Newarr || op == OpCodes.Box || op == OpCodes.Ldftn || op == OpCodes.Ldvirtftn)
                {
                    found.Add(where + ": " + op.Name);
                    continue;
                }
                if (op == OpCodes.Newobj)
                {
                    MethodBase ctor = m.Module.ResolveMethod(BitConverter.ToInt32(il, operandAt), m.DeclaringType.GetGenericArguments(), null);
                    if (!ctor.DeclaringType.IsValueType) found.Add(where + ": newobj " + ctor.DeclaringType.Name);
                    continue;
                }
                if (op == OpCodes.Call || op == OpCodes.Callvirt)
                {
                    MethodBase callee = m.Module.ResolveMethod(BitConverter.ToInt32(il, operandAt), m.DeclaringType.GetGenericArguments(), null);
                    if (Quiet(callee)) continue;
                    string ns = callee.DeclaringType != null ? callee.DeclaringType.Namespace ?? "" : "";
                    // (and the rig's own property getters, which the life pass reads)
                    if (ns.StartsWith("Vande.Practice.Presentation.Production.Director") || (ExtraFollow != null && ExtraFollow(callee)) ||
                        (callee.DeclaringType.Name == "ProductionCharacterRig" && (callee.Name.StartsWith("get_") || callee.Name == "StripDirectedLife"))) Scan(callee, seen, found);
                    else found.Add(where + ": calls " + callee.DeclaringType.Name + "." + callee.Name);
                }
            }
        }
    }
}
