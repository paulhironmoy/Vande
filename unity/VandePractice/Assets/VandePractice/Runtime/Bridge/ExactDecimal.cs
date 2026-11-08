using System;
using System.Globalization;

namespace Vande.Practice.Bridge
{
    /// <summary>
    /// Exact decimal-to-double conversion for JSON number tokens, without allocating and without BigInteger on the common
    /// path. For every grammar-valid token it returns exactly what <see cref="CanonicalJson.TryParseNumberExact"/> returns:
    /// the same accept/reject and the same IEEE-754 bits (JavaScript Number semantics, ties to even).
    ///
    /// Three tiers, each exact:
    ///   1. Clinger's fast path: at most 2^53 as the digit value and a power of ten up to 10^22 is one correctly rounded
    ///      double multiplication or division.
    ///   2. Eisel-Lemire: the digit value (up to 19 digits, as a 64-bit integer) times a 128-bit truncated power of ten
    ///      (table below, generated and verified against BigInteger by the tests). It either decides the correctly
    ///      rounded double or says it cannot (a possible half-way case, a carry the 128 bits cannot settle, a subnormal or
    ///      an overflow), and then
    ///   3. the original BigInteger routine decides. Tokens outside the supported shape (more than 19 significant digits,
    ///      a malformed token) go there directly.
    /// The rules CanonicalJson applies before converting stay in force: more than 24 digits (counting leading zeros), or a
    /// decimal exponent outside [-400, 400], are rejected; any zero mantissa is +0.
    /// </summary>
    internal static class ExactDecimal
    {
        private const int TableMin = -90;
        private const int TableMax = 50;

        private static readonly double[] ExactPowersOfTen =
        {
            1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
            1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22
        };

        /// <summary>
        /// High and low 64 bits of floor(10^q * 2^(127 - floor(log2 10^q))) for q = -90 .. 50, in that order (hi, lo, hi, lo, ...).
        /// Generated with exact rational arithmetic; ExactDecimalTests recomputes every entry with BigInteger.
        /// </summary>
        internal static readonly ulong[] PowersOfTen =
        {
            0x825ECC24C873782FUL, 0x8ED400668C0C28C8UL, // 1e-90
            0xA2F67F2DFA90563BUL, 0x728900802F0F32FAUL, // 1e-89
            0xCBB41EF979346BCAUL, 0x4F2B40A03AD2FFB9UL, // 1e-88
            0xFEA126B7D78186BCUL, 0xE2F610C84987BFA8UL, // 1e-87
            0x9F24B832E6B0F436UL, 0x0DD9CA7D2DF4D7C9UL, // 1e-86
            0xC6EDE63FA05D3143UL, 0x91503D1C79720DBBUL, // 1e-85
            0xF8A95FCF88747D94UL, 0x75A44C6397CE912AUL, // 1e-84
            0x9B69DBE1B548CE7CUL, 0xC986AFBE3EE11ABAUL, // 1e-83
            0xC24452DA229B021BUL, 0xFBE85BADCE996168UL, // 1e-82
            0xF2D56790AB41C2A2UL, 0xFAE27299423FB9C3UL, // 1e-81
            0x97C560BA6B0919A5UL, 0xDCCD879FC967D41AUL, // 1e-80
            0xBDB6B8E905CB600FUL, 0x5400E987BBC1C920UL, // 1e-79
            0xED246723473E3813UL, 0x290123E9AAB23B68UL, // 1e-78
            0x9436C0760C86E30BUL, 0xF9A0B6720AAF6521UL, // 1e-77
            0xB94470938FA89BCEUL, 0xF808E40E8D5B3E69UL, // 1e-76
            0xE7958CB87392C2C2UL, 0xB60B1D1230B20E04UL, // 1e-75
            0x90BD77F3483BB9B9UL, 0xB1C6F22B5E6F48C2UL, // 1e-74
            0xB4ECD5F01A4AA828UL, 0x1E38AEB6360B1AF3UL, // 1e-73
            0xE2280B6C20DD5232UL, 0x25C6DA63C38DE1B0UL, // 1e-72
            0x8D590723948A535FUL, 0x579C487E5A38AD0EUL, // 1e-71
            0xB0AF48EC79ACE837UL, 0x2D835A9DF0C6D851UL, // 1e-70
            0xDCDB1B2798182244UL, 0xF8E431456CF88E65UL, // 1e-69
            0x8A08F0F8BF0F156BUL, 0x1B8E9ECB641B58FFUL, // 1e-68
            0xAC8B2D36EED2DAC5UL, 0xE272467E3D222F3FUL, // 1e-67
            0xD7ADF884AA879177UL, 0x5B0ED81DCC6ABB0FUL, // 1e-66
            0x86CCBB52EA94BAEAUL, 0x98E947129FC2B4E9UL, // 1e-65
            0xA87FEA27A539E9A5UL, 0x3F2398D747B36224UL, // 1e-64
            0xD29FE4B18E88640EUL, 0x8EEC7F0D19A03AADUL, // 1e-63
            0x83A3EEEEF9153E89UL, 0x1953CF68300424ACUL, // 1e-62
            0xA48CEAAAB75A8E2BUL, 0x5FA8C3423C052DD7UL, // 1e-61
            0xCDB02555653131B6UL, 0x3792F412CB06794DUL, // 1e-60
            0x808E17555F3EBF11UL, 0xE2BBD88BBEE40BD0UL, // 1e-59
            0xA0B19D2AB70E6ED6UL, 0x5B6ACEAEAE9D0EC4UL, // 1e-58
            0xC8DE047564D20A8BUL, 0xF245825A5A445275UL, // 1e-57
            0xFB158592BE068D2EUL, 0xEED6E2F0F0D56712UL, // 1e-56
            0x9CED737BB6C4183DUL, 0x55464DD69685606BUL, // 1e-55
            0xC428D05AA4751E4CUL, 0xAA97E14C3C26B886UL, // 1e-54
            0xF53304714D9265DFUL, 0xD53DD99F4B3066A8UL, // 1e-53
            0x993FE2C6D07B7FABUL, 0xE546A8038EFE4029UL, // 1e-52
            0xBF8FDB78849A5F96UL, 0xDE98520472BDD033UL, // 1e-51
            0xEF73D256A5C0F77CUL, 0x963E66858F6D4440UL, // 1e-50
            0x95A8637627989AADUL, 0xDDE7001379A44AA8UL, // 1e-49
            0xBB127C53B17EC159UL, 0x5560C018580D5D52UL, // 1e-48
            0xE9D71B689DDE71AFUL, 0xAAB8F01E6E10B4A6UL, // 1e-47
            0x9226712162AB070DUL, 0xCAB3961304CA70E8UL, // 1e-46
            0xB6B00D69BB55C8D1UL, 0x3D607B97C5FD0D22UL, // 1e-45
            0xE45C10C42A2B3B05UL, 0x8CB89A7DB77C506AUL, // 1e-44
            0x8EB98A7A9A5B04E3UL, 0x77F3608E92ADB242UL, // 1e-43
            0xB267ED1940F1C61CUL, 0x55F038B237591ED3UL, // 1e-42
            0xDF01E85F912E37A3UL, 0x6B6C46DEC52F6688UL, // 1e-41
            0x8B61313BBABCE2C6UL, 0x2323AC4B3B3DA015UL, // 1e-40
            0xAE397D8AA96C1B77UL, 0xABEC975E0A0D081AUL, // 1e-39
            0xD9C7DCED53C72255UL, 0x96E7BD358C904A21UL, // 1e-38
            0x881CEA14545C7575UL, 0x7E50D64177DA2E54UL, // 1e-37
            0xAA242499697392D2UL, 0xDDE50BD1D5D0B9E9UL, // 1e-36
            0xD4AD2DBFC3D07787UL, 0x955E4EC64B44E864UL, // 1e-35
            0x84EC3C97DA624AB4UL, 0xBD5AF13BEF0B113EUL, // 1e-34
            0xA6274BBDD0FADD61UL, 0xECB1AD8AEACDD58EUL, // 1e-33
            0xCFB11EAD453994BAUL, 0x67DE18EDA5814AF2UL, // 1e-32
            0x81CEB32C4B43FCF4UL, 0x80EACF948770CED7UL, // 1e-31
            0xA2425FF75E14FC31UL, 0xA1258379A94D028DUL, // 1e-30
            0xCAD2F7F5359A3B3EUL, 0x096EE45813A04330UL, // 1e-29
            0xFD87B5F28300CA0DUL, 0x8BCA9D6E188853FCUL, // 1e-28
            0x9E74D1B791E07E48UL, 0x775EA264CF55347DUL, // 1e-27
            0xC612062576589DDAUL, 0x95364AFE032A819DUL, // 1e-26
            0xF79687AED3EEC551UL, 0x3A83DDBD83F52204UL, // 1e-25
            0x9ABE14CD44753B52UL, 0xC4926A9672793542UL, // 1e-24
            0xC16D9A0095928A27UL, 0x75B7053C0F178293UL, // 1e-23
            0xF1C90080BAF72CB1UL, 0x5324C68B12DD6338UL, // 1e-22
            0x971DA05074DA7BEEUL, 0xD3F6FC16EBCA5E03UL, // 1e-21
            0xBCE5086492111AEAUL, 0x88F4BB1CA6BCF584UL, // 1e-20
            0xEC1E4A7DB69561A5UL, 0x2B31E9E3D06C32E5UL, // 1e-19
            0x9392EE8E921D5D07UL, 0x3AFF322E62439FCFUL, // 1e-18
            0xB877AA3236A4B449UL, 0x09BEFEB9FAD487C2UL, // 1e-17
            0xE69594BEC44DE15BUL, 0x4C2EBE687989A9B3UL, // 1e-16
            0x901D7CF73AB0ACD9UL, 0x0F9D37014BF60A10UL, // 1e-15
            0xB424DC35095CD80FUL, 0x538484C19EF38C94UL, // 1e-14
            0xE12E13424BB40E13UL, 0x2865A5F206B06FB9UL, // 1e-13
            0x8CBCCC096F5088CBUL, 0xF93F87B7442E45D3UL, // 1e-12
            0xAFEBFF0BCB24AAFEUL, 0xF78F69A51539D748UL, // 1e-11
            0xDBE6FECEBDEDD5BEUL, 0xB573440E5A884D1BUL, // 1e-10
            0x89705F4136B4A597UL, 0x31680A88F8953030UL, // 1e-9
            0xABCC77118461CEFCUL, 0xFDC20D2B36BA7C3DUL, // 1e-8
            0xD6BF94D5E57A42BCUL, 0x3D32907604691B4CUL, // 1e-7
            0x8637BD05AF6C69B5UL, 0xA63F9A49C2C1B10FUL, // 1e-6
            0xA7C5AC471B478423UL, 0x0FCF80DC33721D53UL, // 1e-5
            0xD1B71758E219652BUL, 0xD3C36113404EA4A8UL, // 1e-4
            0x83126E978D4FDF3BUL, 0x645A1CAC083126E9UL, // 1e-3
            0xA3D70A3D70A3D70AUL, 0x3D70A3D70A3D70A3UL, // 1e-2
            0xCCCCCCCCCCCCCCCCUL, 0xCCCCCCCCCCCCCCCCUL, // 1e-1
            0x8000000000000000UL, 0x0000000000000000UL, // 1e0
            0xA000000000000000UL, 0x0000000000000000UL, // 1e1
            0xC800000000000000UL, 0x0000000000000000UL, // 1e2
            0xFA00000000000000UL, 0x0000000000000000UL, // 1e3
            0x9C40000000000000UL, 0x0000000000000000UL, // 1e4
            0xC350000000000000UL, 0x0000000000000000UL, // 1e5
            0xF424000000000000UL, 0x0000000000000000UL, // 1e6
            0x9896800000000000UL, 0x0000000000000000UL, // 1e7
            0xBEBC200000000000UL, 0x0000000000000000UL, // 1e8
            0xEE6B280000000000UL, 0x0000000000000000UL, // 1e9
            0x9502F90000000000UL, 0x0000000000000000UL, // 1e10
            0xBA43B74000000000UL, 0x0000000000000000UL, // 1e11
            0xE8D4A51000000000UL, 0x0000000000000000UL, // 1e12
            0x9184E72A00000000UL, 0x0000000000000000UL, // 1e13
            0xB5E620F480000000UL, 0x0000000000000000UL, // 1e14
            0xE35FA931A0000000UL, 0x0000000000000000UL, // 1e15
            0x8E1BC9BF04000000UL, 0x0000000000000000UL, // 1e16
            0xB1A2BC2EC5000000UL, 0x0000000000000000UL, // 1e17
            0xDE0B6B3A76400000UL, 0x0000000000000000UL, // 1e18
            0x8AC7230489E80000UL, 0x0000000000000000UL, // 1e19
            0xAD78EBC5AC620000UL, 0x0000000000000000UL, // 1e20
            0xD8D726B7177A8000UL, 0x0000000000000000UL, // 1e21
            0x878678326EAC9000UL, 0x0000000000000000UL, // 1e22
            0xA968163F0A57B400UL, 0x0000000000000000UL, // 1e23
            0xD3C21BCECCEDA100UL, 0x0000000000000000UL, // 1e24
            0x84595161401484A0UL, 0x0000000000000000UL, // 1e25
            0xA56FA5B99019A5C8UL, 0x0000000000000000UL, // 1e26
            0xCECB8F27F4200F3AUL, 0x0000000000000000UL, // 1e27
            0x813F3978F8940984UL, 0x4000000000000000UL, // 1e28
            0xA18F07D736B90BE5UL, 0x5000000000000000UL, // 1e29
            0xC9F2C9CD04674EDEUL, 0xA400000000000000UL, // 1e30
            0xFC6F7C4045812296UL, 0x4D00000000000000UL, // 1e31
            0x9DC5ADA82B70B59DUL, 0xF020000000000000UL, // 1e32
            0xC5371912364CE305UL, 0x6C28000000000000UL, // 1e33
            0xF684DF56C3E01BC6UL, 0xC732000000000000UL, // 1e34
            0x9A130B963A6C115CUL, 0x3C7F400000000000UL, // 1e35
            0xC097CE7BC90715B3UL, 0x4B9F100000000000UL, // 1e36
            0xF0BDC21ABB48DB20UL, 0x1E86D40000000000UL, // 1e37
            0x96769950B50D88F4UL, 0x1314448000000000UL, // 1e38
            0xBC143FA4E250EB31UL, 0x17D955A000000000UL, // 1e39
            0xEB194F8E1AE525FDUL, 0x5DCFAB0800000000UL, // 1e40
            0x92EFD1B8D0CF37BEUL, 0x5AA1CAE500000000UL, // 1e41
            0xB7ABC627050305ADUL, 0xF14A3D9E40000000UL, // 1e42
            0xE596B7B0C643C719UL, 0x6D9CCD05D0000000UL, // 1e43
            0x8F7E32CE7BEA5C6FUL, 0xE4820023A2000000UL, // 1e44
            0xB35DBF821AE4F38BUL, 0xDDA2802C8A800000UL, // 1e45
            0xE0352F62A19E306EUL, 0xD50B2037AD200000UL, // 1e46
            0x8C213D9DA502DE45UL, 0x4526F422CC340000UL, // 1e47
            0xAF298D050E4395D6UL, 0x9670B12B7F410000UL, // 1e48
            0xDAF3F04651D47B4CUL, 0x3C0CDD765F114000UL, // 1e49
            0x88D8762BF324CD0FUL, 0xA5880A69FB6AC800UL, // 1e50
        };

        internal static int TableLength => PowersOfTen.Length / 2;
        internal static int FirstExponent => TableMin;

        /// <summary>The same answer as CanonicalJson.TryParseNumberExact(s.Substring(start, end - start)) for a JSON number token.</summary>
        public static bool TryParse(string s, int start, int end, out double value)
        {
            value = 0.0;
            var index = start;
            var negative = false;
            if (index < end && s[index] == '-')
            {
                negative = true;
                index++;
            }

            ulong mantissa = 0;
            var significant = 0;   // digits since the first non-zero one
            var total = 0;         // every digit of the coefficient, leading zeros included (CanonicalJson's digits.Length)
            var fractional = 0;
            var integerDigits = 0;
            while (index < end)
            {
                var digit = s[index] - '0';
                if (digit < 0 || digit > 9) break;
                total++;
                integerDigits++;
                if (significant > 0 || digit != 0)
                {
                    significant++;
                    if (significant <= 19) mantissa = mantissa * 10 + (ulong)digit;
                }
                index++;
            }

            if (index < end && s[index] == '.')
            {
                index++;
                var fractionStart = index;
                while (index < end)
                {
                    var digit = s[index] - '0';
                    if (digit < 0 || digit > 9) break;
                    total++;
                    fractional++;
                    if (significant > 0 || digit != 0)
                    {
                        significant++;
                        if (significant <= 19) mantissa = mantissa * 10 + (ulong)digit;
                    }
                    index++;
                }
                if (index == fractionStart) return Reference(s, start, end, out value);
            }

            var exponent = 0;
            if (index < end && (s[index] == 'e' || s[index] == 'E'))
            {
                index++;
                var exponentNegative = false;
                if (index < end && (s[index] == '+' || s[index] == '-'))
                {
                    exponentNegative = s[index] == '-';
                    index++;
                }
                var exponentStart = index;
                while (index < end)
                {
                    var digit = s[index] - '0';
                    if (digit < 0 || digit > 9) break;
                    if (exponent < 100000) exponent = exponent * 10 + digit;
                    index++;
                }
                if (index == exponentStart) return Reference(s, start, end, out value);
                if (exponentNegative) exponent = -exponent;
            }

            if (index != end || integerDigits == 0) return Reference(s, start, end, out value);
            // CanonicalJson: at most 24 coefficient digits and a decimal exponent in [-400, 400], whatever the value is.
            if (total > 24) return false;
            if (exponent < -400 || exponent > 400) return false;
            if (significant == 0)
            {
                value = 0.0;
                return true;
            }

            if (significant > 19) return Reference(s, start, end, out value);
            var q = exponent - fractional;
            double result;
            if (mantissa <= (1UL << 53) && q >= -22 && q <= 22)
            {
                result = q < 0 ? (double)mantissa / ExactPowersOfTen[-q] : (double)mantissa * ExactPowersOfTen[q];
            }
            else if (!TryEiselLemire(mantissa, q, out result))
            {
                return Reference(s, start, end, out value);
            }

            value = negative ? -result : result;
            return true;
        }

        private static bool Reference(string s, int start, int end, out double value)
        {
            return CanonicalJson.TryParseNumberExact(s.Substring(start, end - start), out value);
        }

        private static int LeadingZeros(ulong x)
        {
            var n = 0;
            if ((x >> 32) == 0) { n += 32; x <<= 32; }
            if ((x >> 48) == 0) { n += 16; x <<= 16; }
            if ((x >> 56) == 0) { n += 8; x <<= 8; }
            if ((x >> 60) == 0) { n += 4; x <<= 4; }
            if ((x >> 62) == 0) { n += 2; x <<= 2; }
            if ((x >> 63) == 0) n += 1;
            return n;
        }

        private static ulong Multiply(ulong a, ulong b, out ulong low)
        {
            var aLow = a & 0xFFFFFFFFUL;
            var aHigh = a >> 32;
            var bLow = b & 0xFFFFFFFFUL;
            var bHigh = b >> 32;
            var p00 = aLow * bLow;
            var p01 = aLow * bHigh;
            var p10 = aHigh * bLow;
            var p11 = aHigh * bHigh;
            var middle = (p00 >> 32) + (p01 & 0xFFFFFFFFUL) + (p10 & 0xFFFFFFFFUL);
            low = (middle << 32) | (p00 & 0xFFFFFFFFUL);
            return p11 + (p01 >> 32) + (p10 >> 32) + (middle >> 32);
        }

        /// <summary>
        /// Eisel and Lemire, "Number Parsing at a Gigabyte per Second" (the same steps as Go's strconv): the correctly rounded
        /// double nearest mantissa * 10^q, or false when 128 bits cannot decide it.
        /// </summary>
        internal static bool TryEiselLemire(ulong mantissa, int q, out double result)
        {
            result = 0.0;
            if (mantissa == 0 || q < TableMin || q > TableMax) return false;
            var shift = LeadingZeros(mantissa);
            mantissa <<= shift;
            var high = PowersOfTen[(q - TableMin) * 2];
            var low = PowersOfTen[(q - TableMin) * 2 + 1];
            long exponent2 = ((217706L * q) >> 16) + 64 + 1023 - shift;

            ulong productLow;
            var productHigh = Multiply(mantissa, high, out productLow);
            if ((productHigh & 0x1FF) == 0x1FF && productLow + mantissa < mantissa)
            {
                // The truncated low half of the power could carry into the bits that decide the rounding: widen the product.
                ulong secondLow;
                var secondHigh = Multiply(mantissa, low, out secondLow);
                var mergedHigh = productHigh;
                var mergedLow = productLow + secondHigh;
                if (mergedLow < productLow) mergedHigh++;
                if ((mergedHigh & 0x1FF) == 0x1FF && mergedLow + 1 == 0 && secondLow + mantissa < mantissa) return false;
                productHigh = mergedHigh;
                productLow = mergedLow;
            }

            var top = productHigh >> 63;
            var rounded = productHigh >> (int)(top + 9);
            exponent2 -= (long)(1UL ^ top);
            // Exactly half way in the approximation, and the approximation is a lower bound: undecidable here.
            if (productLow == 0 && (productHigh & 0x1FF) == 0 && (rounded & 3) == 1) return false;
            rounded += rounded & 1;
            rounded >>= 1;
            if ((rounded >> 53) > 0)
            {
                rounded >>= 1;
                exponent2++;
            }

            if (exponent2 < 1 || exponent2 >= 0x7FF) return false; // subnormal or overflow: the reference decides
            var bits = ((ulong)exponent2 << 52) | (rounded & 0x000FFFFFFFFFFFFFUL);
            result = BitConverter.Int64BitsToDouble(unchecked((long)bits));
            return true;
        }
    }
}
