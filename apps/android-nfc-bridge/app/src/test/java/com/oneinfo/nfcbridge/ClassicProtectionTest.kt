package com.oneinfo.nfcbridge

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ClassicProtectionTest {
    private fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private val password = "49C26785A1FE"
    private class MemoryCard : ClassicProtection.Card {
        override var size = 1024
        val blocks = Array(64) { block -> ByteArray(16) { (block + it).toByte() } }
        var writes = 0
        var failAfter = Int.MAX_VALUE
        private var authenticated = -1
        private var withB = false
        init {
            for (sector in 0..15) {
                val keyA = if (sector == 0) byteArrayOf(0xa0.toByte(),0xa1.toByte(),0xa2.toByte(),0xa3.toByte(),0xa4.toByte(),0xa5.toByte()) else byteArrayOf(0xd3.toByte(),0xf7.toByte(),0xd3.toByte(),0xf7.toByte(),0xd3.toByte(),0xf7.toByte())
                val access = if (sector == 0) byteArrayOf(0x78,0x77,0x88.toByte()) else byteArrayOf(0x7f,0x07,0x88.toByte())
                blocks[sector*4+3] = keyA + access + byteArrayOf(if (sector == 0) 0xc1.toByte() else 0x40) + ByteArray(6) { 0xff.toByte() }
            }
            val mad = ByteArray(32)
            mad[1] = 1
            for (sector in 1..15) { mad[sector*2] = 0x03; mad[sector*2+1] = 0xe1.toByte() }
            blocks[1] = mad.copyOfRange(0,16); blocks[2] = mad.copyOfRange(16,32)
        }
        override fun authenticate(sector: Int, key: ByteArray, keyB: Boolean): Boolean {
            val start = if (keyB) 10 else 0
            val accepted = key.contentEquals(blocks[sector*4+3].copyOfRange(start,start+6))
            authenticated = if (accepted) sector else -1; withB = keyB
            return accepted
        }
        override fun read(block: Int): ByteArray {
            check(authenticated == block/4)
            val bytes = blocks[block].copyOf()
            if (block%4 == 3) { bytes.fill(0,0,6); bytes.fill(0,10,16) }
            return bytes
        }
        override fun write(block: Int, bytes: ByteArray) {
            check(authenticated == block/4)
            if (block%4 != 3 && blocks[block/4*4+3][6] == 0x0f.toByte()) error("WRITE_DENIED")
            if (block%4 == 3 || blocks[block/4*4+3][6] == 0x78.toByte()) check(withB) { "WRITE_DENIED" }
            if (writes >= failAfter) throw IOException("RF removed")
            blocks[block] = bytes.copyOf(); writes++
        }
    }

    @Test fun protectsAllSectorsKeepsPublicReadAndRestoresRewritingWithPassword() {
        val card = MemoryCard()
        val before = card.blocks.map { it.copyOf() }
        assertEquals(16, ClassicProtection.apply(card, password, true))
        for (sector in 0..15) {
            val trailer = card.blocks[sector*4+3]
            assertArrayEquals(hex(if (sector == 0) "787788" else "0F078F"), trailer.copyOfRange(6,9))
            assertEquals(if (sector == 0) 0xc1 else 0x43, trailer[9].toInt() and 0xff)
            assertFalse(card.authenticate(sector, hex("FFFFFFFFFFFF"), true))
            assertTrue(card.authenticate(sector, before[sector*4+3].copyOfRange(0,6), false))
            for (offset in 0..2) assertArrayEquals(before[sector*4+offset], card.read(sector*4+offset))
            try { card.write(sector*4+1, ByteArray(16)); fail("public key must not rewrite") } catch (_: IllegalStateException) {}
        }
        assertEquals(16, ClassicProtection.apply(card, password, false))
        for (i in before.indices) assertArrayEquals(before[i], card.blocks[i])
    }

    @Test fun validatesLateSectorKeysAndLayoutsBeforeWritingAnything() {
        val card = MemoryCard()
        card.blocks[15*4+3][10] = 0x12
        try { ClassicProtection.apply(card, password, true); fail() } catch (_: IllegalStateException) {}
        assertEquals(0, card.writes)
        val otherApp = MemoryCard(); otherApp.blocks[2][1] = 0x12
        try { ClassicProtection.apply(otherApp, password, true); fail() } catch (_: IllegalStateException) {}
        assertEquals(0, otherApp.writes)
        val locked = MemoryCard(); locked.blocks[7][6] = 0x00
        try { ClassicProtection.apply(locked, password, true); fail() } catch (_: IllegalStateException) {}
        assertEquals(0, locked.writes)
    }

    @Test fun refusesWrongPasswordsAndSupportsInterruptedOperationsWithTheSamePassword() {
        val card = MemoryCard()
        card.failAfter = 3
        try { ClassicProtection.apply(card, password, true); fail() } catch (e: IllegalStateException) { assertEquals("PROTECTION_INTERRUPTED_RETRY_SAME_PASSWORD", e.message) }
        val previousWrites = card.writes
        try { ClassicProtection.apply(card, "123456ABCDEF", false); fail() } catch (_: IllegalStateException) {}
        assertEquals(previousWrites, card.writes)
        card.failAfter = Int.MAX_VALUE
        assertEquals(16, ClassicProtection.apply(card, password, true))
        assertEquals(16, ClassicProtection.apply(card, password, true))
        assertEquals(16, ClassicProtection.apply(card, password, false))
    }

    @Test fun rejectsOtherSizesAndPublicPasswordsWithoutWriting() {
        for (key in listOf("FFFFFFFFFFFF","000000000000","D3F7D3F7D3F7","A0A1A2A3A4A5","wrong")) {
            val card = MemoryCard()
            try { ClassicProtection.apply(card,key,true); fail() } catch (_: IllegalArgumentException) {}
            assertEquals(0,card.writes)
        }
        val card = MemoryCard(); card.size = 4096
        try { ClassicProtection.apply(card,password,true); fail() } catch (_: IllegalStateException) {}
        assertEquals(0,card.writes)
    }
}
