package edu.library;
import java.security.SecureRandom;
/** Service-generated positive IDs within the browser's exact integer range. */
final class Ids {
 private static final SecureRandom RANDOM=new SecureRandom();
 static long next(){return 1000+(RANDOM.nextLong()&((1L<<52)-1));}
 private Ids(){}
}
