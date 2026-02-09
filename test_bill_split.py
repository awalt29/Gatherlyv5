#!/usr/bin/env python3
"""Test bill splitting prompt with dummy data"""

import os
import sys
from dotenv import load_dotenv
from openai import OpenAI

# Load .env file
load_dotenv()

# Get API key - check both env var and allow passing as argument
api_key = os.environ.get('OPENAI_API_KEY')
if not api_key and len(sys.argv) > 1:
    api_key = sys.argv[1]

if not api_key:
    print("❌ No OPENAI_API_KEY found. Either:")
    print("   1. Add it to your .env file")
    print("   2. Pass it as argument: python3 test_bill_split.py sk-your-key")
    sys.exit(1)

client = OpenAI(api_key=api_key)

def test_bill_split():
    """Test the bill split prompt with text-only scenario (no images needed for logic test)"""
    
    all_participants = ['Aaron Walters', 'Jake King']
    chat_context = """
- Aaron Walters: there were 5 people. we each had 1 drink at apotheke and we split the bottle at all blues evenly
"""
    
    # Simulate receipt data as text (since we can't easily test with images)
    receipt_data = """
RECEIPT 1 - All Blues Inc:
- 1 Bottle DASSAI BLUE: $81.00
- Subtotal: $81.00
- Tax: $7.18
- Tip: $14.58
- Total: $102.76

RECEIPT 2 - Apotheke Chinatown:
- Fever Tree Club Soda: $4.59
- Days Before Spring: $20.20
- Aniki: $20.20
- Wartime Consigliere: $20.20
- Summer Bee: $20.20
- Subtotal: $85.39
- Tax: $7.61
- Tip: $17.08
- Total: $110.08

COMBINED TOTAL: $212.84
"""

    system_prompt = f"""Split this bill. Participants: {', '.join(all_participants)}

Instructions: {chat_context}

Rules:
1. Count people exactly as stated. Use known names, then Person 1, Person 2...
2. "split X" = divide item equally
3. "each had 1 X" = assign one item to each person at its actual price

FORMULA: person owes = (their item price ÷ subtotal) × total

Example: Subtotal $85.39, Total $110.08
- $4.59 item: ($4.59 ÷ $85.39) × $110.08 = $5.91
- $20.20 item: ($20.20 ÷ $85.39) × $110.08 = $26.02

VERIFY: All "owes" amounts must add up to the receipt total!

Output:
**Items:**
- [Name]: [item] ($X.XX)

**Owes:**
- [Name]: $XX.XX

Total: $XXX.XX"""

    print("=" * 60)
    print("TEST: 5 people, each had 1 drink + split bottle")
    print("=" * 60)
    print(f"\nExpected calculation:")
    print(f"  Receipt 1 (All Blues $102.76): $102.76 / 5 = $20.55 each")
    print(f"  Receipt 2 (Apotheke $110.08):")
    print(f"    - Soda person ($4.59): $4.59/$85.39 × $110.08 = $5.91")
    print(f"    - $20.20 drink person: $20.20/$85.39 × $110.08 = $26.03")
    print(f"  Expected totals:")
    print(f"    - Soda person: $20.55 + $5.91 = $26.46")
    print(f"    - Others: $20.55 + $26.03 = $46.58")
    print(f"  Total: $26.46 + 4×$46.58 = $212.78 (≈$212.84)")
    print("=" * 60)
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Here are the receipts:\n{receipt_data}"}
        ],
        max_tokens=1500,
        temperature=0
    )
    
    result = response.choices[0].message.content
    print("\nAI RESPONSE:")
    print(result)
    print("=" * 60)
    
    # Check if result is correct
    if "$26" in result and "$46" in result:
        print("\n✅ PASS - Different amounts for soda person vs others")
    elif "$42" in result or "$24" in result or "$48" in result:
        print("\n❌ FAIL - Still doing even split")
    else:
        print("\n⚠️  UNCLEAR - Check output manually")


def test_simple_split():
    """Test a simpler scenario: 2 people, one had expensive item, one had cheap"""
    
    all_participants = ['Alice', 'Bob']
    chat_context = """
- Alice: I had the steak, Bob had the salad
"""
    
    receipt_data = """
RECEIPT:
- Ribeye Steak: $45.00
- House Salad: $12.00
- Subtotal: $57.00
- Tax: $5.00
- Tip: $10.00
- Total: $72.00
"""

    system_prompt = f"""Split this bill. Participants: {', '.join(all_participants)}

Instructions: {chat_context}

Rules:
1. Count people exactly as stated. Use known names, then Person 1, Person 2...
2. "split X" = divide item equally
3. "each had 1 X" = assign one item to each person at its actual price

FORMULA: person owes = (their item price ÷ subtotal) × total

Example: Subtotal $85.39, Total $110.08
- $4.59 item: ($4.59 ÷ $85.39) × $110.08 = $5.91
- $20.20 item: ($20.20 ÷ $85.39) × $110.08 = $26.02

VERIFY: All "owes" amounts must add up to the receipt total!

Output:
**Items:**
- [Name]: [item] ($X.XX)

**Owes:**
- [Name]: $XX.XX

Total: $XXX.XX"""

    print("\n" + "=" * 60)
    print("TEST: Alice had steak ($45), Bob had salad ($12)")
    print("=" * 60)
    print(f"\nExpected calculation:")
    print(f"  Alice: $45/$57 × $72 = $56.84")
    print(f"  Bob: $12/$57 × $72 = $15.16")
    print(f"  Total: $72.00")
    print("=" * 60)
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Here is the receipt:\n{receipt_data}"}
        ],
        max_tokens=1500,
        temperature=0
    )
    
    result = response.choices[0].message.content
    print("\nAI RESPONSE:")
    print(result)
    print("=" * 60)
    
    # Check if result is correct
    if "$56" in result and "$15" in result:
        print("\n✅ PASS - Correct proportional split")
    elif "$36" in result:
        print("\n❌ FAIL - Did even split ($36 each)")
    else:
        print("\n⚠️  UNCLEAR - Check output manually")


def test_shared_item():
    """Test shared item scenario"""
    
    all_participants = ['Alice', 'Bob']
    chat_context = """
- Alice: We split the appetizer, I had the pasta, Bob had the burger
"""
    
    receipt_data = """
RECEIPT:
- Nachos (appetizer): $18.00
- Spaghetti Carbonara: $22.00
- Classic Burger: $16.00
- Subtotal: $56.00
- Tax: $5.00
- Tip: $11.00
- Total: $72.00
"""

    system_prompt = f"""Split this bill. Participants: {', '.join(all_participants)}

Instructions: {chat_context}

Rules:
1. Count people exactly as stated. Use known names, then Person 1, Person 2...
2. "split X" = divide item equally
3. "each had 1 X" = assign one item to each person at its actual price

FORMULA: person owes = (their item price ÷ subtotal) × total

Example: Subtotal $85.39, Total $110.08
- $4.59 item: ($4.59 ÷ $85.39) × $110.08 = $5.91
- $20.20 item: ($20.20 ÷ $85.39) × $110.08 = $26.02

VERIFY: All "owes" amounts must add up to the receipt total!

Output:
**Items:**
- [Name]: [item] ($X.XX)

**Owes:**
- [Name]: $XX.XX

Total: $XXX.XX"""

    print("\n" + "=" * 60)
    print("TEST: Split appetizer ($18), Alice pasta ($22), Bob burger ($16)")
    print("=" * 60)
    print(f"\nExpected calculation:")
    print(f"  Alice: ($9 + $22)/$56 × $72 = $39.86")
    print(f"  Bob: ($9 + $16)/$56 × $72 = $32.14")
    print(f"  Total: $72.00")
    print("=" * 60)
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Here is the receipt:\n{receipt_data}"}
        ],
        max_tokens=1500,
        temperature=0
    )
    
    result = response.choices[0].message.content
    print("\nAI RESPONSE:")
    print(result)
    print("=" * 60)
    
    # Check if result is correct
    if "$39" in result and "$32" in result:
        print("\n✅ PASS - Correct split with shared appetizer")
    elif "$36" in result:
        print("\n❌ FAIL - Did even split ($36 each)")
    else:
        print("\n⚠️  UNCLEAR - Check output manually")


def test_single_receipt_drinks():
    """Test single receipt: 5 people, each had 1 drink at different prices"""
    
    all_participants = ['Aaron Walters', 'Jake King']
    chat_context = """
- Aaron Walters: there were 5 people and we each had 1 drink
"""
    
    # Single receipt - Apotheke only
    receipt_data = """
RECEIPT - Apotheke Chinatown:
- Fever Tree Club Soda: $4.59
- Days Before Spring: $20.20
- Aniki: $20.20
- Wartime Consigliere: $20.20
- Summer Bee: $20.20
- Subtotal: $85.39
- Tax: $7.61
- Tip: $17.08
- Total: $110.08
"""

    system_prompt = f"""Split this bill. Participants: {', '.join(all_participants)}

Instructions: {chat_context}

Rules:
1. Count people exactly as stated. Use known names, then Person 1, Person 2...
2. "split X" = divide item equally
3. "each had 1 X" = assign one item to each person at its actual price

FORMULA: person owes = (their item price ÷ subtotal) × total

Example: Subtotal $85.39, Total $110.08
- $4.59 item: ($4.59 ÷ $85.39) × $110.08 = $5.91
- $20.20 item: ($20.20 ÷ $85.39) × $110.08 = $26.02

VERIFY: All "owes" amounts must add up to the receipt total!

Output:
**Items:**
- [Name]: [item] ($X.XX)

**Owes:**
- [Name]: $XX.XX

Total: $XXX.XX"""

    print("\n" + "=" * 60)
    print("TEST: Single receipt - 5 people, each had 1 drink (different prices)")
    print("=" * 60)
    print(f"\nExpected calculation:")
    print(f"  Drinks: $4.59, $20.20, $20.20, $20.20, $20.20")
    print(f"  Soda person ($4.59): $4.59/$85.39 × $110.08 = $5.91")
    print(f"  Others ($20.20): $20.20/$85.39 × $110.08 = $26.03")
    print(f"  Total: $5.91 + 4×$26.03 = $110.03 (≈$110.08)")
    print("=" * 60)
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Here is the receipt:\n{receipt_data}"}
        ],
        max_tokens=1500,
        temperature=0
    )
    
    result = response.choices[0].message.content
    print("\nAI RESPONSE:")
    print(result)
    print("=" * 60)
    
    # Check if result shows different amounts
    if "$5" in result or "$6" in result:
        if "$26" in result or "$25" in result:
            print("\n✅ PASS - Different amounts for soda person vs others")
        else:
            print("\n⚠️  UNCLEAR - Check output manually")
    elif "$22" in result:
        print("\n❌ FAIL - Did even split ($22 each)")
    else:
        print("\n⚠️  UNCLEAR - Check output manually")


if __name__ == "__main__":
    print("\n🧪 BILL SPLIT PROMPT TESTING\n")
    
    test_simple_split()
    test_shared_item()
    test_single_receipt_drinks()
    
    print("\n✨ Tests complete!\n")
