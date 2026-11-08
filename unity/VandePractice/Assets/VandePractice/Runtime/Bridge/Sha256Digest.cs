using System;
using System.Security.Cryptography;
using System.Text;

namespace Vande.Practice.Bridge
{
    public static class Sha256Digest
    {
        public static string OfBytes(byte[] bytes)
        {
            if (bytes == null)
            {
                throw new ArgumentNullException(nameof(bytes));
            }

            using (var algorithm = SHA256.Create())
            {
                return ToLowerHex(algorithm.ComputeHash(bytes));
            }
        }

        public static string OfUtf8(string value)
        {
            if (value == null)
            {
                throw new ArgumentNullException(nameof(value));
            }

            using (var stream = new Sha256Stream())
            {
                stream.Append(value, 0, value.Length);
                return stream.Finish();
            }
        }

        public static bool FixedTimeEqualsLowerHex(string expected, string actual)
        {
            if (!IsLowerHexSha256(expected) || !IsLowerHexSha256(actual))
            {
                return false;
            }

            var difference = 0;
            for (var index = 0; index < expected.Length; index++)
            {
                difference |= expected[index] ^ actual[index];
            }

            return difference == 0;
        }

        public static bool IsLowerHexSha256(string value)
        {
            if (value == null || value.Length != 64)
            {
                return false;
            }

            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))
                {
                    return false;
                }
            }

            return true;
        }

        internal static string ToLowerHex(byte[] bytes)
        {
            const string digits = "0123456789abcdef";
            var characters = new char[bytes.Length * 2];
            for (var index = 0; index < bytes.Length; index++)
            {
                characters[index * 2] = digits[bytes[index] >> 4];
                characters[index * 2 + 1] = digits[bytes[index] & 0x0F];
            }

            return new string(characters);
        }
    }

    /// <summary>
    /// SHA-256 over the UTF-8 encoding of text appended piece by piece: the digest of the concatenation, without building the
    /// concatenation or its byte array. Encoding.UTF8 is applied in chunks that never split a surrogate pair, so the bytes are
    /// exactly those of Encoding.UTF8.GetBytes(whole text) (a lone surrogate becomes U+FFFD either way).
    /// </summary>
    internal sealed class Sha256Stream : IDisposable
    {
        private const int ChunkCharacters = 16384;
        [ThreadStatic] private static byte[] scratch;
        private readonly SHA256 algorithm = SHA256.Create();

        public void Append(string text, int index, int count)
        {
            var buffer = scratch;
            if (buffer == null)
            {
                buffer = new byte[ChunkCharacters * 3];
                scratch = buffer;
            }

            var encoding = Encoding.UTF8;
            while (count > 0)
            {
                var take = count < ChunkCharacters ? count : ChunkCharacters;
                if (take < count && char.IsHighSurrogate(text[index + take - 1]) && char.IsLowSurrogate(text[index + take]))
                {
                    take--;
                }

                var length = encoding.GetBytes(text, index, take, buffer, 0);
                algorithm.TransformBlock(buffer, 0, length, null, 0);
                index += take;
                count -= take;
            }
        }

        public void Append(string text)
        {
            Append(text, 0, text.Length);
        }

        public string Finish()
        {
            algorithm.TransformFinalBlock(new byte[0], 0, 0);
            return Sha256Digest.ToLowerHex(algorithm.Hash);
        }

        public void Dispose()
        {
            algorithm.Dispose();
        }
    }
}
