#!/usr/bin/env python3
"""Test the bill splitting prompt with the Thai restaurant scenario"""

import openai
import sys

# Get API key from command line or environment
if len(sys.argv) > 1:
    api_key = sys.argv[1]
else:
    import os
    api_key = os.getenv('OPENAI_API_KEY')

if not api_key:
    print("Usage: python test_bill_split.py <OPENAI_API_KEY>")
    sys.exit(1)

client = openai.OpenAI(api_key=api_key)

# The exact scenario from the user's screenshots
participants = ['Aaron Walters', 'Gina Rhee', 'Arvind Balasundaram']

chat_context = """- Aaron Walters: i had the panda with the N and the kao soy kua neur
- Gina Rhee: I had the To Be Tamarind and Goong Muk Prik Klua
- Aaron Walters: arvind had the jakapat, the white rice, and the kao soy gai
- Aaron Walters: and we split the roti masaman 3 ways"""

# Since we can't use the actual image, we'll describe the receipt in text
# This simulates what the vision API would extract
receipt_text = """Receipt contents:
1 To be Tamarind - $19.00
1 Jakapat - $19.00
1 Panda With The "N" - $19.00
1 Roti Massamun - $16.00
1 Goong Muk Prik Klua - $30.00
1 Kao Soy Kua Neur - $28.00
1 Kao Soy Gai - $28.00
1 White rice - $4.00

Subtotal: $163.00
Tax: $14.47
Tip: $32.60
Total: $210.07"""

system_prompt = f"""Split this bill. Participants: {', '.join(participants)}

Instructions from chat: {chat_context}

EXAMPLE CALCULATION:
Receipt: Burger $15, Salad $12, Fries $8 (split 2 ways). Subtotal $35, Total $42.
- Alice had burger, Bob had salad, both split fries.
- Alice subtotal: $15 + $4 = $19
- Bob subtotal: $12 + $4 = $16
- Multiplier: $42 / $35 = 1.20
- Alice owes: $19 × 1.20 = $22.80
- Bob owes: $16 × 1.20 = $19.20

YOUR TASK (calculate internally, only output the final result):
1. For each person, find their items on the receipt and note the EXACT price
2. If item is shared, divide its price by number of people sharing
3. Sum each person's item prices = their subtotal
4. Multiplier = receipt_total / receipt_subtotal
5. Each person's final = their_subtotal × multiplier
6. Verify all finals sum to receipt total

CRITICAL: The person with more expensive items MUST owe more money!

OUTPUT FORMAT (no math shown):
**Items:**
- [Name]: [item1], [item2]...

**Owes:**
- [Name]: $XX.XX

Total: $XXX.XX"""

print("=" * 60)
print("TESTING BILL SPLIT PROMPT")
print("=" * 60)
print(f"\nParticipants: {participants}")
print(f"\nChat context:\n{chat_context}")
print(f"\nReceipt:\n{receipt_text}")
print("\n" + "=" * 60)
print("EXPECTED RESULTS:")
print("=" * 60)
print("""
Aaron: Panda ($19) + Kao Soy Kua Neur ($28) + 1/3 Roti ($5.33) = $52.33
  → $52.33 × 1.2886 = $67.44

Gina: To Be Tamarind ($19) + Goong Muk Prik Klua ($30) + 1/3 Roti ($5.33) = $54.33
  → $54.33 × 1.2886 = $70.02

Arvind: Jakapat ($19) + White Rice ($4) + Kao Soy Gai ($28) + 1/3 Roti ($5.33) = $56.33
  → $56.33 × 1.2886 = $72.61

Total: $210.07
""")

print("=" * 60)
print("AI RESPONSE:")
print("=" * 60)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": receipt_text}
    ],
    max_tokens=1500,
    temperature=0
)

ai_response = response.choices[0].message.content
print(ai_response)

print("\n" + "=" * 60)
print("VERIFICATION:")
print("=" * 60)

# Check if the amounts are roughly correct
import re
amounts = re.findall(r'\$(\d+\.\d{2})', ai_response)
if amounts:
    # Filter to likely "owes" amounts (between $50-$100 for this scenario)
    owes_amounts = [float(a) for a in amounts if 50 < float(a) < 100]
    if len(owes_amounts) == 3:
        total = sum(owes_amounts)
        print(f"Individual amounts found: {owes_amounts}")
        print(f"Sum: ${total:.2f}")
        print(f"Expected: $210.07")
        print(f"Difference: ${abs(total - 210.07):.2f}")
        
        # Check if Gina > Aaron (she had the $30 item)
        # This assumes the order in output matches participant order
        print(f"\nGina should owe MORE than Aaron (she had the $30 Goong Muk Prik Klua)")
