package edu.library.identity;

import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.stereotype.Component;

@Component
final class Passwords {
    private static final int ROUNDS = 600_000;
    private static final int SALT_BYTES = 16;
    private static final int HASH_BITS = 256;
    private static final String PREFIX = "pbkdf2-sha256$" + ROUNDS + "$";
    private final SecureRandom random = new SecureRandom();
    private final Base64.Encoder encoder = Base64.getEncoder().withoutPadding();

    String encode(String password) {
        byte[] salt = new byte[SALT_BYTES];
        random.nextBytes(salt);
        return PREFIX + encoder.encodeToString(salt) + "$" + encoder.encodeToString(derive(password, salt));
    }

    boolean matches(String password, String stored) {
        if (stored == null || !stored.startsWith(PREFIX)) return false;
        String[] parts = stored.substring(PREFIX.length()).split("\\$", -1);
        if (parts.length != 2) return false;
        try {
            byte[] salt = Base64.getDecoder().decode(parts[0]);
            byte[] expected = Base64.getDecoder().decode(parts[1]);
            return salt.length == SALT_BYTES && expected.length == HASH_BITS / 8
                    && MessageDigest.isEqual(expected, derive(password, salt));
        } catch (IllegalArgumentException invalidEncoding) {
            return false;
        }
    }

    private byte[] derive(String password, byte[] salt) {
        char[] chars = password.toCharArray();
        PBEKeySpec spec = new PBEKeySpec(chars, salt, ROUNDS, HASH_BITS);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException unavailable) {
            throw new IllegalStateException("Password hashing is unavailable", unavailable);
        } finally {
            spec.clearPassword();
            java.util.Arrays.fill(chars, '\0');
        }
    }
}
