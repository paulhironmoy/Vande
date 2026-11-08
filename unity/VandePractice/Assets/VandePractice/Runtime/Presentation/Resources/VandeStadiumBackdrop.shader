Shader "Vande/Practice/StadiumBackdrop"
{
    Properties
    {
        _MainTex ("Stadium plate", 2D) = "white" {}
        _Tint ("Tint", Color) = (1,1,1,1)
        _HazeColor ("Horizon haze", Color) = (0.66,0.77,0.86,1)
        _HorizonHaze ("Horizon integration", Range(0,0.25)) = 0.09
        _FieldTint ("Field integration tint", Color) = (0.91,0.84,0.65,1)
        _FieldBlend ("Field integration", Range(0,0.3)) = 0.16
        _EdgeFeather ("Edge feather", Range(0.01,0.25)) = 0.055
        _ScreenCutout ("Reveal physical red-ball sight screen", Range(0,1)) = 0
        _ScreenBounds ("Physical sight-screen UV bounds", Vector) = (0.42,0.58,0.25,0.46)
        _CrowdReveal ("Reveal causal 3D crowd", Range(0,0.3)) = 0.14
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-20" }
        LOD 100

        Pass
        {
            Cull Off
            ZWrite Off
            ZTest LEqual
            Blend SrcAlpha OneMinusSrcAlpha

            CGPROGRAM
            #pragma target 2.0
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Tint;
            fixed4 _HazeColor;
            fixed4 _FieldTint;
            half _HorizonHaze;
            half _FieldBlend;
            half _EdgeFeather;
            half _ScreenCutout;
            half4 _ScreenBounds;
            half _CrowdReveal;

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            v2f vert(appdata input)
            {
                v2f output = (v2f)0;
                output.pos = UnityObjectToClipPos(input.vertex);
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);
                return output;
            }

            fixed4 frag(v2f input) : SV_Target
            {
                fixed4 sampled = tex2D(_MainTex, input.uv) * _Tint;
                // The facade remains a static original plate, but its exposure
                // now shares the realtime atmosphere. A restrained horizon haze
                // and warm lower-field multiplier remove the visible compositing
                // seam without masking crowd or sight-screen state.
                const half horizonBand = saturate(1.0h - abs(input.uv.y - 0.49h) / 0.27h);
                sampled.rgb = lerp(sampled.rgb, _HazeColor.rgb,
                                   horizonBand * saturate(_HorizonHaze));
                const half fieldBand = 1.0h - smoothstep(0.18h, 0.48h, input.uv.y);
                sampled.rgb *= lerp(half3(1.0h, 1.0h, 1.0h), _FieldTint.rgb,
                                    fieldBand * saturate(_FieldBlend));
                const half horizontal = min(input.uv.x, 1.0h - input.uv.x);
                const half top = 1.0h - input.uv.y;
                const half edge = min(horizontal, top);
                half alpha = smoothstep(0.0h, _EdgeFeather, edge);
                half screenX = step(_ScreenBounds.x, input.uv.x) *
                               step(input.uv.x, _ScreenBounds.y);
                half screenY = step(_ScreenBounds.z, input.uv.y) *
                               step(input.uv.y, _ScreenBounds.w);
                const half crowdBand = smoothstep(0.455h, 0.505h, input.uv.y) *
                                       (1.0h - smoothstep(0.745h, 0.805h, input.uv.y));
                const half screenReserve = 1.0h - step(0.355h, input.uv.x) *
                                            step(input.uv.x, 0.645h);
                alpha *= 1.0h - crowdBand * screenReserve * _CrowdReveal;
                alpha *= 1.0h - screenX * screenY * saturate(_ScreenCutout);
                return fixed4(sampled.rgb, sampled.a * alpha);
            }
            ENDCG
        }
    }

    Fallback Off
}
