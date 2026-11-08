using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.Presentation.Production.Props;

namespace Vande.Practice.Presentation.Production.Environment
{
    /// <summary>
    /// A small, deterministic distant crowd. It reacts only when an emotion
    /// observer calls SetEmotion; there is no random idle Update loop.
    /// </summary>
    public sealed class ProductionCrowdView
    {
        private readonly Section[] sections;
        private readonly Material[] shirts;
        private readonly Color[] baseShirtColours;
        private readonly bool reducedMotion;
        private bool quiet;
        private float pendingValence;
        private float pendingArousal;
        private Vector3? pendingFocus;

        private ProductionCrowdView(
            Section[] sections,
            Material[] shirts,
            Color[] baseShirtColours,
            int count,
            bool reducedMotion)
        {
            this.sections = sections;
            this.shirts = shirts;
            this.baseShirtColours = baseShirtColours;
            this.reducedMotion = reducedMotion;
            Count = count;
        }

        public int Count { get; }
        public bool IsQuiet => quiet;

        internal static ProductionCrowdView Create(
            Transform parent,
            int count,
            bool reducedMotion,
            ProductionOwnedVisual owner)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (owner == null) throw new ArgumentNullException(nameof(owner));
            var colours = new[]
            {
                new Color(0.12f, 0.19f, 0.48f),
                new Color(0.82f, 0.39f, 0.08f),
                new Color(0.13f, 0.40f, 0.31f),
                new Color(0.57f, 0.15f, 0.25f)
            };
            var materials = new Material[colours.Length];
            for (var index = 0; index < materials.Length; index++)
            {
                materials[index] = owner.Own(ProductionVisualPrimitives.CreateMaterial(
                    "VANDE crowd shirt " + index, colours[index]));
                ConfigureCrowdSurface(materials[index]);
            }

            const int sectionCount = 8;
            var sections = new Section[sectionCount];
            var assigned = 0;
            for (var sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++)
            {
                var remainingSections = sectionCount - sectionIndex;
                var sectionPeople = (count - assigned + remainingSections - 1) / remainingSections;
                var sectionRoot = new GameObject("CrowdSection-" + sectionIndex).transform;
                sectionRoot.SetParent(parent, false);
                var mesh = owner.Own(BuildSection(sectionIndex, sectionPeople));
                ProductionVisualPrimitives.CreateMeshObject(
                    "Spectators", sectionRoot, mesh, materials, false);
                var angle = Mathf.PI * 2f * (sectionIndex + 0.5f) / sectionCount;
                sections[sectionIndex] = new Section(sectionRoot, angle);
                assigned += sectionPeople;
            }
            return new ProductionCrowdView(sections, materials, colours, assigned, reducedMotion);
        }

        public void SetQuiet(bool value)
        {
            quiet = value;
            if (value)
            {
                // Delivery Quiet Mode freezes at rest, so decorative movement cannot
                // compete with release, flight or contact.
                ResetSections();
                return;
            }
            ApplyEmotion(pendingValence, pendingArousal, pendingFocus);
        }

        public void SetEmotion(float valence, float arousal, Vector3? focus)
        {
            pendingValence = Mathf.Clamp(valence, -1f, 1f);
            pendingArousal = Mathf.Clamp01(arousal);
            pendingFocus = focus;
            if (quiet) return;
            ApplyEmotion(pendingValence, pendingArousal, pendingFocus);
        }

        /// <summary>
        /// Clears all outcome emotion before another delivery or replay. This
        /// restores both visible state and the pending state used when Quiet
        /// Mode ends, so a prior result cannot reappear after the next ball.
        /// </summary>
        public void ResetEmotion()
        {
            pendingValence = 0f;
            pendingArousal = 0f;
            pendingFocus = null;
            for (var index = 0; index < shirts.Length; index++)
                shirts[index].color = baseShirtColours[index];
            ResetSections();
        }

        private void ApplyEmotion(float valence, float arousal, Vector3? focus)
        {
            var moodLift = Mathf.Max(0f, valence) * 0.12f;
            for (var index = 0; index < shirts.Length; index++)
                shirts[index].color = Color.Lerp(
                    baseShirtColours[index],
                    valence >= 0f ? Color.white : new Color(0.25f, 0.28f, 0.35f),
                    Mathf.Abs(valence) * 0.12f);

            if (arousal <= 0.12f || reducedMotion)
            {
                ResetSections();
                return;
            }

            var focusAngle = focus.HasValue && focus.Value.sqrMagnitude > 0.001f
                ? Mathf.Atan2(focus.Value.x, focus.Value.z)
                : float.NaN;
            for (var index = 0; index < sections.Length; index++)
            {
                var weight = 1f;
                if (!float.IsNaN(focusAngle))
                {
                    var delta = Mathf.Abs(Mathf.DeltaAngle(
                        sections[index].Angle * Mathf.Rad2Deg,
                        focusAngle * Mathf.Rad2Deg));
                    weight = Mathf.Lerp(0.35f, 1f, 1f - Mathf.Clamp01(delta / 180f));
                }
                var phase = (index % 3) / 2f;
                var height = (0.025f + phase * 0.035f + moodLift) * arousal * weight;
                sections[index].Root.localPosition = Vector3.up * height;
                sections[index].Root.localRotation = Quaternion.Euler(
                    0f, 0f, (index % 2 == 0 ? 1f : -1f) * arousal * weight * 0.6f);
            }
        }

        private void ResetSections()
        {
            for (var index = 0; index < sections.Length; index++)
            {
                sections[index].Root.localPosition = Vector3.zero;
                sections[index].Root.localRotation = Quaternion.identity;
            }
        }

        private static Mesh BuildSection(int sectionIndex, int count)
        {
            var builder = new ProductionMeshBuilder(4);
            const float sectionArc = Mathf.PI * 2f / 8f;
            var centreAngle = sectionArc * (sectionIndex + 0.5f);
            var rowCount = count <= 24 ? 4 : count <= 96 ? 8 : 12;
            var columns = Mathf.CeilToInt(count / (float)rowCount);
            var lowerRows = rowCount <= 4 ? rowCount : Mathf.CeilToInt(rowCount * 0.67f);
            for (var index = 0; index < count; index++)
            {
                // A row stagger prevents rigid clone columns while keeping the
                // crowd deterministic and seated on the actual two-tier stands.
                var row = index % rowCount;
                var column = index / rowCount;
                var stagger = ((row * 0.381966f) % 1f - 0.5f) * 0.36f;
                var along = ((column + 0.5f + stagger) / columns - 0.5f) *
                            sectionArc * 0.82f;
                var angle = centreAngle + along;
                float radius;
                float seatHeight;
                if (row < lowerRows)
                {
                    var lowerT = lowerRows <= 1 ? 0f : row / (float)(lowerRows - 1);
                    radius = Mathf.Lerp(72.2f, 88f, lowerT);
                    seatHeight = Mathf.Lerp(1.55f, 10.1f, lowerT);
                }
                else
                {
                    var upperRow = row - lowerRows;
                    var upperCount = rowCount - lowerRows;
                    var upperT = upperRow / (float)Mathf.Max(1, upperCount);
                    radius = Mathf.Lerp(94f, 108f, upperT);
                    seatHeight = Mathf.Lerp(14.5f, 26.5f, upperT);
                }

                var bottom = new Vector3(
                    Mathf.Sin(angle) * radius,
                    seatHeight,
                    Mathf.Cos(angle) * radius);
                var inward = new Vector3(-bottom.x, 0f, -bottom.z).normalized;
                var right = Vector3.Cross(Vector3.up, inward).normalized;
                var halfWidth = 0.17f;
                var height = 0.70f + (index % 5) * 0.015f;
                var materialIndex = (sectionIndex + index * 3) % 4;
                builder.AddQuad(
                    bottom - right * halfWidth,
                    bottom + right * halfWidth,
                    bottom + right * halfWidth + Vector3.up * height,
                    bottom - right * halfWidth + Vector3.up * height,
                    inward,
                    materialIndex);

                // One triangle gives the distant silhouette a head without a
                // second material, renderer or high-poly generated character.
                if (rowCount > 4)
                {
                    var shoulders = bottom + Vector3.up * height;
                    const float headRadius = 0.13f;
                    builder.AddTriangle(
                        shoulders + right * headRadius,
                        shoulders + Vector3.up * headRadius * 2.1f,
                        shoulders - right * headRadius,
                        inward,
                        materialIndex);
                }
            }
            return builder.Build("VANDE tiered crowd section " + sectionIndex);
        }

        private static void ConfigureCrowdSurface(Material material)
        {
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.08f);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
            if (material.HasProperty("_AmbientStrength")) material.SetFloat("_AmbientStrength", 0.82f);
            if (material.HasProperty("_RimStrength")) material.SetFloat("_RimStrength", 0.035f);
        }

        private readonly struct Section
        {
            internal Section(Transform root, float angle)
            {
                Root = root;
                Angle = angle;
            }

            internal Transform Root { get; }
            internal float Angle { get; }
        }
    }
}
