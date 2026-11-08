Shader "Vande/Practice/Lit"
{
    Properties
    {
        _Color ("Colour", Color) = (1, 1, 1, 1)
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 2.0
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };

            struct v2f
            {
                float4 position : SV_POSITION;
                float light : TEXCOORD0;
            };

            fixed4 _Color;

            v2f vert(appdata input)
            {
                v2f output;
                output.position = UnityObjectToClipPos(input.vertex);
                float3 normal = UnityObjectToWorldNormal(input.normal);
                float3 keyLight = normalize(float3(0.38, 0.82, -0.43));
                output.light = 0.42 + 0.58 * saturate(dot(normal, keyLight));
                return output;
            }

            fixed4 frag(v2f input) : SV_Target
            {
                return fixed4(_Color.rgb * input.light, _Color.a);
            }
            ENDCG
        }
    }
    Fallback Off
}
