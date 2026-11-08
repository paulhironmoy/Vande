Shader "Vande/Practice/Surface"
{
    Properties
    {
        _Color ("Tint", Color) = (1,1,1,1)
        _MainTex ("Albedo", 2D) = "white" {}
        _Smoothness ("Smoothness", Range(0,1)) = 0.32
        _Metallic ("Metallic", Range(0,1)) = 0
        _AmbientStrength ("Ambient strength", Range(0,2)) = 0.82
        _RimStrength ("Rim strength", Range(0,1)) = 0.04
        _Saturation ("Albedo saturation", Range(0,1.25)) = 1
        _AlbedoGain ("Albedo gain", Range(0.35,1.25)) = 1
        _EmissionColor ("Emission", Color) = (0,0,0,0)
        _Unlit ("Unlit", Range(0,1)) = 0
        _UseVertexColor ("Use vertex colour", Range(0,1)) = 0
        _FogStrength ("Fog strength", Range(0,1)) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 220

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

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            half _Smoothness;
            half _Metallic;
            half _AmbientStrength;
            half _RimStrength;
            half _Saturation;
            half _AlbedoGain;
            fixed4 _EmissionColor;
            half _Unlit;
            half _UseVertexColor;
            half _FogStrength;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                fixed4 color : COLOR;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                half3 normalWorld : TEXCOORD1;
                float3 worldPos : TEXCOORD2;
                UNITY_SHADOW_COORDS(3)
                UNITY_FOG_COORDS(4)
                fixed4 vertexColor : COLOR;
            };

            v2f vert(appdata input)
            {
                v2f output = (v2f)0;
                output.pos = UnityObjectToClipPos(input.vertex);
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);
                output.normalWorld = UnityObjectToWorldNormal(input.normal);
                output.worldPos = mul(unity_ObjectToWorld, input.vertex).xyz;
                output.vertexColor = input.color;
                UNITY_TRANSFER_SHADOW(output, output.worldPos);
                UNITY_TRANSFER_FOG(output, output.pos);
                return output;
            }

            fixed4 frag(v2f input) : SV_Target
            {
                const half3 normal = normalize(input.normalWorld);
                const half3 lightDirection = normalize(UnityWorldSpaceLightDir(input.worldPos));
                const half3 viewDirection = normalize(UnityWorldSpaceViewDir(input.worldPos));
                const half attenuation = UNITY_SHADOW_ATTENUATION(input, input.worldPos);
                const half diffuse = saturate(dot(normal, lightDirection));
                const fixed4 vertexTint = lerp(fixed4(1, 1, 1, 1), input.vertexColor,
                                                saturate(_UseVertexColor));
                fixed4 sampled = tex2D(_MainTex, input.uv) * _Color * vertexTint;
                // Per-material albedo calibration keeps high-chroma generated
                // source textures inside the same restrained broadcast palette
                // as the stadium plate. Defaults are neutral so props and all
                // existing non-environment materials remain unchanged.
                const half albedoLuma = dot(sampled.rgb, half3(0.2126h, 0.7152h, 0.0722h));
                sampled.rgb = lerp(albedoLuma.xxx, sampled.rgb, saturate(_Saturation)) *
                              _AlbedoGain;

                const half3 ambient = ShadeSH9(half4(normal, 1.0h)) * _AmbientStrength;
                const half3 direct = _LightColor0.rgb * diffuse * attenuation;
                const half3 halfVector = normalize(lightDirection + viewDirection);
                const half specPower = lerp(8.0h, 96.0h, _Smoothness);
                const half specular = pow(saturate(dot(normal, halfVector)), specPower) *
                                      lerp(0.035h, 1.0h, _Metallic) * _Smoothness * attenuation;
                const half rim = pow(1.0h - saturate(dot(normal, viewDirection)), 3.0h) * _RimStrength;

                const half3 litColour = sampled.rgb * (ambient + direct) +
                                        _LightColor0.rgb * specular + sampled.rgb * rim;
                const half3 colour = lerp(litColour, sampled.rgb, saturate(_Unlit)) +
                                     _EmissionColor.rgb;
                const fixed4 unfogged = fixed4(colour, sampled.a);
                fixed4 fogged = unfogged;
                UNITY_APPLY_FOG(input.fogCoord, fogged);
                return lerp(unfogged, fogged, saturate(_FogStrength));
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

            struct shadowInput
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };

            struct shadowOutput
            {
                V2F_SHADOW_CASTER;
            };

            shadowOutput shadowVertex(shadowInput v)
            {
                shadowOutput output;
                TRANSFER_SHADOW_CASTER_NORMALOFFSET(output)
                return output;
            }

            float4 shadowFragment(shadowOutput input) : SV_Target
            {
                SHADOW_CASTER_FRAGMENT(input)
            }
            ENDCG
        }
    }

    Fallback "Diffuse"
}
