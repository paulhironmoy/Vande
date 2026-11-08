Shader "Vande/Practice/Character"
{
    Properties
    {
        _Skin ("Skin", Color) = (0.54,0.32,0.20,1)
        _SkinShade ("Skin shade", Color) = (0.36,0.19,0.12,1)
        _SkinTex ("Pinned CC0 skin albedo", 2D) = "white" {}
        [HideInInspector] _SkinTextureEnabled ("Skin texture enabled", Float) = 0
        _EyeTex ("Pinned CC0 eye albedo", 2D) = "white" {}
        [HideInInspector] _EyeTextureEnabled ("Eye texture enabled", Float) = 0
        _KitNormalTex ("Pinned CC0 kit normal", 2D) = "bump" {}
        _KitAoTex ("Pinned CC0 kit ambient occlusion", 2D) = "white" {}
        [HideInInspector] _KitSurfaceEnabled ("Kit surface maps enabled", Float) = 0
        _Hair ("Hair", Color) = (0.055,0.043,0.038,1)
        _Iris ("Iris", Color) = (0.16,0.09,0.045,1)
        _KitPrimary ("Kit primary", Color) = (0.055,0.19,0.34,1)
        _KitSecondary ("Kit secondary", Color) = (0.93,0.52,0.12,1)
        _Trousers ("Trousers", Color) = (0.035,0.11,0.20,1)
        _Helmet ("Helmet", Color) = (0.035,0.106,0.188,1)
        _Pad ("Pads", Color) = (0.90,0.89,0.83,1)
        _Glove ("Gloves", Color) = (0.84,0.82,0.76,1)
        _Shoe ("Shoes", Color) = (0.82,0.84,0.86,1)
        _Sole ("Soles", Color) = (0.12,0.13,0.14,1)
        _Strap ("Equipment straps", Color) = (0.08,0.09,0.11,1)
        _Padding ("Helmet padding", Color) = (0.08,0.075,0.07,1)
        _Metal ("Metal", Color) = (0.66,0.69,0.72,1)
        _AmbientStrength ("Ambient strength", Range(0,2)) = 0.82
        _MinimumAmbient ("Minimum ambient readability", Range(0,0.3)) = 0.12
        _RimStrength ("Rim strength", Range(0,1)) = 0.08
        _RimColor ("Floodlight rim", Color) = (0.52,0.67,0.92,1)
        _FillColor ("Camera-side broadcast fill", Color) = (0.64,0.70,0.78,1)
        _BroadcastFill ("Camera-side broadcast fill strength", Range(0,1)) = 0.42
        _SkinTextureExposure ("Skin texture exposure", Range(0.8,1.4)) = 1.18
        _SkinPaletteTintStrength ("Skin palette tint strength", Range(0,0.65)) = 0.45
        _SkinShadowLift ("Skin shadow readability", Range(0,0.3)) = 0.16
        _FaceReadability ("Face readability", Range(0,0.25)) = 0.16
        _KitShadowLift ("Kit shadow readability", Range(0,0.12)) = 0.04
        _KitNormalStrength ("Kit normal strength", Range(0,0.5)) = 0.24
        _KitAoStrength ("Kit ambient occlusion strength", Range(0,0.4)) = 0.20
        _SkinWrap ("Skin wrap", Range(0,0.6)) = 0.38
        _GroundBounce ("Ground bounce", Range(0,0.3)) = 0.08
        _FabricDetail ("Fabric detail", Range(0,0.08)) = 0.025
        _KitDetail ("Kit and equipment detail", Range(0,1)) = 0.72
        _HelmetNapeContrast ("Helmet nape contrast", Range(0,0.4)) = 0.26
        _CompressionSleeveEnabled ("Compression sleeve", Range(0,1)) = 1
        [HideInInspector] _VandeOcclusionEllipse ("Occlusion ellipse (viewport centre xy, radii zw)", Vector) = (0.5,0.5,0,0)
        [HideInInspector] _VandeOcclusionFade ("Occlusion screen-door fade", Range(0,1)) = 0
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 250

        Pass
        {
            Tags { "LightMode"="ForwardBase" }
            Cull Back
            ZWrite On

            CGPROGRAM
            #pragma target 2.0
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fwdbase
            #pragma multi_compile_fog
            #include "UnityCG.cginc"
            #include "Lighting.cginc"
            #include "AutoLight.cginc"

            half4 _Skin, _SkinShade, _Hair, _Iris;
            sampler2D _SkinTex;
            half _SkinTextureEnabled;
            sampler2D _EyeTex;
            half _EyeTextureEnabled;
            sampler2D _KitNormalTex, _KitAoTex;
            half _KitSurfaceEnabled;
            half4 _KitPrimary, _KitSecondary, _Trousers, _Helmet;
            half4 _Pad, _Glove, _Shoe, _Sole, _Strap, _Padding, _Metal;
            half4 _RimColor, _FillColor;
            half _AmbientStrength, _MinimumAmbient, _RimStrength, _BroadcastFill;
            half _SkinTextureExposure, _SkinPaletteTintStrength, _SkinShadowLift, _FaceReadability;
            half _KitShadowLift;
            half _KitNormalStrength, _KitAoStrength;
            half _SkinWrap, _GroundBounce, _FabricDetail, _KitDetail;
            half _HelmetNapeContrast, _CompressionSleeveEnabled;
            float4 _VandeOcclusionEllipse;
            half _VandeOcclusionFade;

            // Ordered 4x4 Bayer threshold in (0, 1), from integer pixel coordinates (no arrays: target 2.0).
            half bayer4(float2 pixel)
            {
                const float2 p = fmod(pixel, 4.0);
                const float2 a = fmod(p, 2.0);
                const float2 b = floor(p * 0.5);
                const float coarse = fmod(a.x * 2.0 + a.y * 3.0, 4.0);
                const float fine = fmod(b.x * 2.0 + b.y * 3.0, 4.0);
                return (half)((coarse * 4.0 + fine + 0.5) / 16.0);
            }

            // Screen-door fade of only the fragments inside a viewport ellipse (the striker's region), used for a
            // keeper who stands up between the rear camera and the batter. Never a full removal: the caller caps the
            // fade below 1 and the rest of the body, its shadow and its depth are unchanged.
            void occlusionFade(float3 worldPos)
            {
                if (_VandeOcclusionFade <= 0.001h) return;
                const float4 clipPos = mul(UNITY_MATRIX_VP, float4(worldPos, 1.0));
                float2 viewport = clipPos.xy / max(clipPos.w, 1e-5) * 0.5 + 0.5;
                if (_ProjectionParams.x < 0.0) viewport.y = 1.0 - viewport.y;
                const float2 d = (viewport - _VandeOcclusionEllipse.xy) / max(_VandeOcclusionEllipse.zw, 1e-4);
                const half inside = 1.0h - smoothstep(0.62h, 1.0h, (half)sqrt(dot(d, d)));
                clip(bayer4(floor(viewport * _ScreenParams.xy)) - _VandeOcclusionFade * inside);
            }

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 tangent : TANGENT;
                fixed4 color : COLOR;
                float2 uv : TEXCOORD0;
                float3 bindPosition : TEXCOORD1;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                half3 normalWorld : TEXCOORD0;
                float3 worldPos : TEXCOORD1;
                float3 bindPosition : TEXCOORD2;
                float4 surface : TEXCOORD3;
                UNITY_SHADOW_COORDS(4)
                UNITY_FOG_COORDS(5)
                half4 tangentWorld : TEXCOORD6;
            };

            v2f vert(appdata input)
            {
                v2f output = (v2f)0;
                output.pos = UnityObjectToClipPos(input.vertex);
                output.normalWorld = UnityObjectToWorldNormal(input.normal);
                output.tangentWorld = half4(
                    UnityObjectToWorldDir(input.tangent.xyz),
                    input.tangent.w * unity_WorldTransformParams.w);
                output.worldPos = mul(unity_ObjectToWorld, input.vertex).xyz;
                output.bindPosition = input.bindPosition;
                output.surface = float4(
                    input.uv,
                    floor(input.color.r * 255.0h + 0.5h),
                    input.color.g);
                UNITY_TRANSFER_SHADOW(output, output.worldPos);
                UNITY_TRANSFER_FOG(output, output.pos);
                return output;
            }

            half ellipse(float2 samplePosition, float2 centre, float2 radius)
            {
                const float2 d = (samplePosition - centre) / radius;
                return 1.0h - smoothstep(0.86h, 1.0h, dot(d, d));
            }

            half3 skinColour(float3 p)
            {
                half3 colour = _Skin.rgb;
                const half face = smoothstep(0.055h, 0.085h, p.z) * smoothstep(1.57h, 1.63h, p.y);
                const half eyeLeft = ellipse(p.xy, float2(0.033, 1.707), float2(0.014, 0.006)) * face;
                const half eyeRight = ellipse(p.xy, float2(-0.033, 1.707), float2(0.014, 0.006)) * face;
                const half eyes = saturate(eyeLeft + eyeRight);
                colour = lerp(colour, half3(0.92, 0.90, 0.86), eyes);
                const half irisLeft = ellipse(p.xy, float2(0.033, 1.707), float2(0.0047, 0.0047)) * face;
                const half irisRight = ellipse(p.xy, float2(-0.033, 1.707), float2(0.0047, 0.0047)) * face;
                colour = lerp(colour, _Iris.rgb, saturate(irisLeft + irisRight));
                const half mouth = ellipse(p.xy, float2(0.0, 1.635), float2(0.023, 0.0045)) * face;
                colour = lerp(colour, lerp(_SkinShade.rgb, half3(0.58, 0.25, 0.25), 0.35), mouth * 0.72h);
                const half browLeft = ellipse(p.xy, float2(0.033, 1.722), float2(0.018, 0.0035)) * face;
                const half browRight = ellipse(p.xy, float2(-0.033, 1.722), float2(0.018, 0.0035)) * face;
                colour = lerp(colour, _Hair.rgb, saturate(browLeft + browRight) * 0.42h);
                const half cheek = ellipse(p.xy, float2(0.0, 1.665), float2(0.058, 0.032)) * face;
                colour = lerp(colour, half3(colour.r * 1.04h, colour.g * 0.98h, colour.b * 0.97h), cheek * 0.20h);
                const half hairline = smoothstep(1.765h, 1.80h, p.y) * smoothstep(-0.03h, 0.05h, p.z);
                return lerp(colour, _Hair.rgb, hairline * 0.85h);
            }

            half3 regionColour(
                half region,
                float3 p,
                float2 skinUv,
                half hasSkinUv,
                out half smoothness,
                out half metallic)
            {
                smoothness = 0.18h;
                metallic = 0.0h;
                half3 colour = _KitSecondary.rgb;
                if (region < 0.5h)
                {
                    smoothness = 0.30h;
                    const half useSkinTexture = saturate(_SkinTextureEnabled) *
                                                step(0.5h, hasSkinUv);
                    // The pinned CC0 atlas is deliberately photographic and therefore carries its own deep
                    // hair/helmet-side values. A small, fixed exposure preserves that texture while keeping eyes,
                    // nose, mouth and jaw readable under the rear-shoulder daylight key. This is constant material
                    // calibration, not stateful exposure or outcome feedback.
                    const half3 paletteRatio = clamp(
                        _Skin.rgb / half3(0.54h, 0.32h, 0.20h),
                        half3(0.72h, 0.72h, 0.72h),
                        half3(1.28h, 1.28h, 1.28h));
                    const half3 paletteTint = lerp(
                        half3(1.0h, 1.0h, 1.0h),
                        paletteRatio,
                        _SkinPaletteTintStrength);
                    const half3 texturedSkin = saturate(
                        tex2D(_SkinTex, skinUv).rgb * _SkinTextureExposure * paletteTint);
                    colour = lerp(skinColour(p), texturedSkin, useSkinTexture);
                    // The original kit uses a fitted long compression undersleeve. Bind-space bounds select only
                    // lower-arm anatomy; hands and every facial sample remain photographic skin. This also
                    // prevents a crossed bare forearm from reading as a detached waist or midriff gap.
                    const half sleeveSide = smoothstep(0.27h, 0.32h, abs(p.x)) *
                        (1.0h - smoothstep(0.415h, 0.445h, abs(p.x)));
                    const half sleeveHeight = smoothstep(1.08h, 1.13h, p.y) *
                        (1.0h - smoothstep(1.30h, 1.34h, p.y));
                    const half sleeveDepth = 1.0h - smoothstep(0.185h, 0.215h, p.z);
                    const half sleeve = sleeveSide * sleeveHeight * sleeveDepth *
                        saturate(_CompressionSleeveEnabled);
                    const half sleeveWeave = sin(p.x * 280.0h) * sin(p.y * 340.0h) *
                        _FabricDetail;
                    colour = lerp(colour, _KitPrimary.rgb * (1.0h + sleeveWeave), sleeve);
                }
                else if (region < 1.5h)
                {
                    smoothness = 0.10h;
                    const half front = smoothstep(0.03h, 0.08h, p.z);
                    const half rear = 1.0h - smoothstep(-0.06h, 0.015h, p.z);
                    const half chevron = (1.0h - smoothstep(0.012h, 0.032h,
                        abs(p.y - 1.34h + abs(p.x) * 0.62h))) * front;
                    const half placket = (1.0h - smoothstep(0.007h, 0.016h, abs(p.x))) *
                                         smoothstep(1.29h, 1.37h, p.y) *
                                         (1.0h - smoothstep(1.51h, 1.58h, p.y)) * front;
                    // The rear shoulder is the dominant gameplay view. A restrained original yoke and side seam
                    // keep the jersey readable as cloth without a texture, sponsor, team mark or high-frequency UI.
                    const half rearYoke = (1.0h - smoothstep(0.010h, 0.026h,
                        abs(p.y - 1.505h + abs(p.x) * 0.15h))) * rear;
                    const half sideSeam = (1.0h - smoothstep(0.010h, 0.024h,
                        abs(abs(p.x) - 0.185h))) *
                        smoothstep(1.17h, 1.28h, p.y) *
                        (1.0h - smoothstep(1.54h, 1.61h, p.y));
                    const half weave = (sin(p.x * 330.0h) * sin(p.y * 390.0h)) *
                                       _FabricDetail;
                    const half broadFold = (sin(p.y * 34.0h + p.x * 19.0h) +
                                            sin(p.y * 19.0h - p.x * 31.0h)) *
                                           0.006h * _KitDetail;
                    half3 kit = lerp(_KitPrimary.rgb, _KitSecondary.rgb, chevron * 0.9h);
                    kit *= 1.0h + weave + broadFold;
                    kit = lerp(kit, _KitSecondary.rgb, rearYoke * 0.18h * _KitDetail);
                    kit = lerp(kit, _KitSecondary.rgb, sideSeam * 0.14h * _KitDetail);
                    colour = lerp(kit, _KitSecondary.rgb, placket * 0.26h);
                }
                else if (region < 2.5h)
                {
                    smoothness = 0.08h;
                    const half seam = 1.0h - smoothstep(0.008h, 0.020h, abs(abs(p.x) - 0.115h));
                    colour = _Trousers.rgb * (1.0h + seam * 0.035h);
                }
                else if (region < 3.5h) { smoothness = 0.34h; colour = _Shoe.rgb; }
                else if (region < 4.5h)
                {
                    smoothness = 0.16h;
                    // Cricket-pad rolls run vertically; varying across x avoids the horizontal banding which made
                    // the bridge mesh read as generic armour from the rear-shoulder camera.
                    const half verticalRoll = 0.955h + 0.045h * abs(sin(p.x * 108.0h));
                    const half wear = 1.0h - 0.025h * smoothstep(0.18h, 0.48h, abs(p.y - 0.43h));
                    colour = _Pad.rgb * lerp(1.0h, verticalRoll * wear, _KitDetail);
                }
                else if (region < 5.5h)
                {
                    smoothness = 0.20h;
                    // The live glove deliberately uses a closed finger bank instead of detached finger tubes.
                    // Eight percent tonal channels keep that safe low-triangle silhouette legible as a gripping
                    // hand rather than one clipped white blob.
                    const half panel = 0.92h + 0.08h * abs(sin((p.x + p.y) * 105.0h));
                    colour = _Glove.rgb * panel;
                }
                else if (region < 6.5h)
                {
                    smoothness = 0.46h;
                    const half shellGradient = lerp(0.94h, 1.035h,
                        smoothstep(1.57h, 1.82h, p.y));
                    const half rear = 1.0h - smoothstep(-0.030h, 0.018h, p.z);
                    const half nape = rear * (1.0h - smoothstep(1.600h, 1.675h, p.y));
                    const half rearPanelBreak = lerp(
                        1.0h, 1.0h - _HelmetNapeContrast, nape * _KitDetail);
                    colour = _Helmet.rgb * lerp(1.0h, shellGradient, _KitDetail) * rearPanelBreak;
                }
                else if (region < 7.5h) { smoothness = 0.62h; metallic = 0.82h; colour = _Metal.rgb; }
                else if (region < 8.5h) colour = _KitPrimary.rgb;
                else if (region < 9.5h) colour = _KitPrimary.rgb;
                else if (region < 10.5h) colour = _Sole.rgb;
                else if (region < 11.5h) colour = _Hair.rgb;
                else if (region < 12.5h) colour = _Glove.rgb;
                else if (region < 13.5h) colour = _Strap.rgb;
                else if (region < 14.5h) colour = _Padding.rgb;
                else if (region < 15.5h) { smoothness = 0.58h; metallic = 0.7h; colour = _Metal.rgb; }
                else if (region < 16.5h)
                {
                    smoothness = 0.46h;
                    const half useEyeTexture = saturate(_EyeTextureEnabled) * step(0.5h, hasSkinUv);
                    colour = lerp(half3(0.90h, 0.88h, 0.83h),
                        tex2D(_EyeTex, skinUv).rgb, useEyeTexture);
                }
                return colour;
            }

            fixed4 frag(v2f input) : SV_Target
            {
                occlusionFade(input.worldPos);
                const half region = input.surface.z;
                const half3 geometricNormal = normalize(input.normalWorld);
                half3 normal = geometricNormal;
                half surfaceOcclusion = 1.0h;
                // VPM3 stores a tangent and the source garment UV for every licensed-kit vertex. Only the generic
                // uniform/trouser regions may consume these two CC0 maps: skin, hair, shoes and original cricket
                // equipment stay completely outside this branch. Restrained strengths retain the palette-authored
                // kit colour and avoid the plastic, over-normalled look on low-resolution mobile silhouettes.
                const half kitClothRegion = step(0.5h, region) * (1.0h - step(2.5h, region));
                if (_KitSurfaceEnabled > 0.5h && kitClothRegion > 0.5h)
                {
                    half3 tangentNormal = UnpackNormal(tex2D(_KitNormalTex, input.surface.xy));
                    tangentNormal.xy *= _KitNormalStrength;
                    tangentNormal.z = sqrt(saturate(1.0h - dot(tangentNormal.xy, tangentNormal.xy)));
                    const half3 tangent = normalize(input.tangentWorld.xyz);
                    const half3 bitangent = normalize(cross(geometricNormal, tangent)) *
                                             input.tangentWorld.w;
                    normal = normalize(tangent * tangentNormal.x +
                                       bitangent * tangentNormal.y +
                                       geometricNormal * tangentNormal.z);
                    surfaceOcclusion = lerp(
                        1.0h,
                        tex2D(_KitAoTex, input.surface.xy).r,
                        _KitAoStrength);
                }
                const half3 lightDirection = normalize(UnityWorldSpaceLightDir(input.worldPos));
                const half3 viewDirection = normalize(UnityWorldSpaceViewDir(input.worldPos));
                const half attenuation = UNITY_SHADOW_ATTENUATION(input, input.worldPos);
                half smoothness;
                half metallic;
                const half3 albedo = regionColour(
                    region,
                    input.bindPosition,
                    input.surface.xy,
                    input.surface.w,
                    smoothness,
                    metallic);
                // The photographed face sits below a dark helmet brim in the stable rear-shoulder view. Restrict
                // the additional readability to the actual bind-space face patch so arms, pads, the ball and the
                // rest of the skin atlas retain their calibrated contrast. This is a fixed material term: it adds
                // no light, pass, texture lookup or gameplay-dependent exposure.
                const half faceRegion = (1.0h - step(0.5h, region)) *
                    smoothstep(0.045h, 0.080h, input.bindPosition.z) *
                    smoothstep(1.57h, 1.63h, input.bindPosition.y) *
                    (1.0h - smoothstep(1.80h, 1.84h, input.bindPosition.y));
                const half eyeRegion = step(15.5h, region) * (1.0h - step(16.5h, region));
                const half skinLikeRegion = saturate((1.0h - step(0.5h, region)) + eyeRegion);
                const half ndl = dot(normal, lightDirection);
                const half wrappedDiffuse = saturate((ndl + _SkinWrap) / (1.0h + _SkinWrap));
                const half diffuse = lerp(saturate(ndl), wrappedDiffuse, skinLikeRegion);
                const half up = saturate(normal.y * 0.5h + 0.5h);
                const half down = 1.0h - up;
                // Unity WebGL scenes do not always have a light probe at every animated player. Keep a restrained
                // lower bound so a dark original kit still exposes anatomy and equipment instead of becoming a
                // black cut-out. This is material readability, not exposure compensation or outcome feedback.
                const half3 probeAmbient = ShadeSH9(half4(normal, 1.0h)) * _AmbientStrength;
                const half3 ambientFloor = half3(0.88h, 0.94h, 1.0h) * _MinimumAmbient;
                const half3 ambient = max(probeAmbient, ambientFloor);
                const half3 direct = _LightColor0.rgb * diffuse * attenuation;
                const half3 halfVector = normalize(lightDirection + viewDirection);
                const half specular = pow(saturate(dot(normal, halfVector)), lerp(10.0h, 80.0h, smoothness)) *
                                      smoothness * attenuation;
                const half cameraFacing = saturate(dot(normal, viewDirection));
                const half fresnel = pow(1.0h - cameraFacing, 2.0h);
                // One neutral, camera-side fill keeps the embodied batter readable from the stable rear-shoulder
                // gameplay camera. It is constant for the whole delivery, affects no gameplay state and remains
                // albedo-preserving: dark kit stays dark instead of becoming a flat emissive silhouette. Keeping a
                // bounded contribution on turning surfaces also prevents shoulders and protective equipment from
                // disappearing as the body moves across the daylight key.
                const half fillFacing = lerp(0.32h, 1.0h, cameraFacing);
                const half faceFill = _BroadcastFill +
                    _FaceReadability * (faceRegion + eyeRegion * 0.35h);
                const half3 fill = albedo * _FillColor.rgb * faceFill * fillFacing *
                                   lerp(1.0h, surfaceOcclusion, 0.45h);
                // A region-aware shadow floor avoids the captured black-face failure without bleaching the white
                // pads or turning the dark original kit emissive. It contributes only where the directional key is
                // absent, remains albedo-preserving and adds no texture lookup or rendering pass.
                const half keyVisibility = saturate(diffuse * attenuation);
                const half shadowReadability =
                    (lerp(_KitShadowLift, _SkinShadowLift, skinLikeRegion) +
                     _FaceReadability * 0.5h * faceRegion) * (1.0h - keyVisibility);
                const half3 shadowLift = albedo * half3(1.0h, 0.92h, 0.84h) * shadowReadability;
                const half3 bounce = albedo * half3(0.16h, 0.085h, 0.035h) * down * _GroundBounce;
                const half3 rim = _RimColor.rgb * fresnel * _RimStrength * lerp(0.5h, 1.0h, up);
                const half3 specularColour = lerp(half3(0.035h, 0.035h, 0.035h), albedo, metallic) *
                                             specular;
                half4 colour = half4(albedo * (ambient * surfaceOcclusion + direct) +
                                     fill + shadowLift + bounce + rim +
                                     _LightColor0.rgb * specularColour, 1.0h);
                UNITY_APPLY_FOG(input.fogCoord, colour);
                return colour;
            }
            ENDCG
        }

        Pass
        {
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On
            ZTest LEqual
            CGPROGRAM
            #pragma target 2.0
            #pragma vertex shadowVertex
            #pragma fragment shadowFragment
            #pragma multi_compile_shadowcaster
            #include "UnityCG.cginc"
            struct shadowInput { float4 vertex : POSITION; float3 normal : NORMAL; };
            struct shadowOutput { V2F_SHADOW_CASTER; };
            shadowOutput shadowVertex(shadowInput v)
            {
                shadowOutput output;
                TRANSFER_SHADOW_CASTER_NORMALOFFSET(output)
                return output;
            }
            float4 shadowFragment(shadowOutput input) : SV_Target { SHADOW_CASTER_FRAGMENT(input) }
            ENDCG
        }
    }
    Fallback "Diffuse"
}
