/* ========================================================================================
 * IONIBOT - THE TREE
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * THE WHOLE INSTRUCTION MANUAL, AS DATA.
 *
 * One file, reviewable, diffable, sign-off-able under Policy 986. Nothing here is
 * scattered through components, so the copy can be read and approved by someone who
 * does not read TypeScript, and a translator needs no developer.
 *
 * COPY RULES ENFORCED HERE
 *   Short sentences. Target Grade 8, written for an English second-language reader.
 *   No jargon in body copy. Banned: DNS, resolver, DHCP, gateway, IPv6 (except where
 *   the customer must find that literal word in their router's own menu), Pi-hole,
 *   container, upstream, ARP. Use "looking up website names", "your router",
 *   "your box".
 *   Whose fault it is goes in the FIRST sentence.
 *   One action per numbered step.
 *   Never "error" or "failed" without the next action in the same breath.
 *   Never claim something is fixed before it is.
 *
 * architectureDependent: true marks copy that exists ONLY because the box makes a
 * permanent change to the router that only the living box can undo.
 *
 * ADR-001 WAS ACCEPTED 2026-08-24, so that rewrite has now HAPPENED. The router
 * forwards to us as its upstream; devices are never pointed at us. Nothing is
 * taken from the router, so a dead box costs filtering, not internet. Every screen
 * that carried the flag was rewritten and the flag is now unused - a test asserts
 * the set is empty. The flag stays in the type as a tripwire: if a future feature
 * reintroduces a dependency only the living box can undo, flag it there and the
 * test will make that visible instead of letting it land quietly in copy.
 *
 * Deleted by that rewrite: IB-205, the hand-revert emergency walkthrough. There is
 * no emergency to walk out of any more.
 * ====================================================================================== */

import type { Tree } from './types';

export const TREE: Tree = {
  // 2.0.0, not 1.0.1: ADR-001 changed what the customer is told to do to their
  // router. Anyone holding a translation of 1.x must re-read it, not merge it.
  version: '2.0.0',
  netcheckContract: '2026-08-18',
  root: 'IB-000',

  stateScreens: {
    S0: 'IB-201',
    S1: 'IB-203',
    S2: 'IB-204',
    S3: 'IB-206',
    S4: 'IB-208',
    S5: 'IB-209',
    S6: 'IB-210',
  },

  screens: {
    /* ================================================================== ROOT */

    'IB-000': {
      id: 'IB-000',
      title: 'How can I help?',
      actions: [
        { label: 'Set up my Gate^Flame', kind: 'goto', go: 'IB-101', weight: 'primary' },
        { label: "Something isn't working", kind: 'goto', go: 'IB-200' },
        { label: 'A website I need is blocked', kind: 'goto', go: 'IB-301' },
        { label: 'Check my protection', kind: 'goto', go: 'IB-401' },
        { label: 'Turn filtering off for a while', kind: 'goto', go: 'IB-501' },
        { label: 'Move, replace or remove my box', kind: 'goto', go: 'IB-601' },
      ],
    },

    /* ================================================================= SETUP */

    'IB-101': {
      id: 'IB-101',
      title: 'What you need',
      body: [
        'This takes about five minutes.',
        "You will need your Gate^Flame box and its power supply, the network cable that came in the box, and your router's admin password.",
        "No router password? It is often printed on a sticker on the router itself. If you cannot find it, I can show you another way.",
      ],
      actions: [
        { label: 'I have everything', kind: 'goto', go: 'IB-102', weight: 'primary' },
        { label: 'I cannot find my router password', kind: 'goto', go: 'IB-110' },
      ],
    },

    'IB-102': {
      id: 'IB-102',
      title: 'Plug it in',
      steps: [
        'Plug the network cable from the box into any spare port on your router.',
        'Plug in the power.',
        'Wait until the screen on the box shows a code.',
      ],
      body: ['The first start-up takes about a minute.'],
      actions: [
        { label: 'I see a code', kind: 'goto', go: 'IB-104', weight: 'primary' },
        { label: 'Nothing on the screen', kind: 'goto', go: 'IB-103' },
      ],
    },

    'IB-103': {
      id: 'IB-103',
      title: 'No screen yet',
      body: ["Let's check the basics. Give it two full minutes after plugging in before deciding it is not working."],
      steps: [
        'Push the power adapter all the way in at both ends.',
        'Check the plug is switched on at the wall.',
        'Try a different wall socket.',
      ],
      actions: [
        { label: 'It is working now', kind: 'goto', go: 'IB-104', weight: 'primary' },
        { label: 'Still nothing', kind: 'goto', go: 'IB-990' },
      ],
    },

    'IB-104': {
      id: 'IB-104',
      title: 'Join the same Wi-Fi',
      body: [
        'Make sure this phone is on the same Wi-Fi as your router, not on mobile data.',
        'I will find the box by myself once you are on the right network.',
      ],
      actions: [
        { label: 'Open Wi-Fi settings', kind: 'openWifiSettings' },
        { label: 'I am connected', kind: 'goto', go: 'IB-105', weight: 'primary' },
      ],
    },

    'IB-105': {
      id: 'IB-105',
      title: 'Enter the pairing code',
      body: [
        "Type the code showing on the box's screen.",
        'The code runs out after a few minutes. If it does, the box shows a new one by itself. Just read the new code.',
      ],
      actions: [
        { label: 'Continue', kind: 'startPairing', go: 'IB-106', weight: 'primary' },
        { label: 'I cannot find the box', kind: 'goto', go: 'IB-209' },
      ],
    },

    'IB-106': {
      id: 'IB-106',
      title: 'Why I need your router password',
      body: [
        'One setting on your router has to change, once, so that every device in your house is protected and not just this phone.',
        'I will change that one setting and nothing else.',
        'Your password is used for this and then forgotten. It is never saved, never written down, and never sent anywhere.',
      ],
      actions: [
        { label: 'Continue', kind: 'goto', go: 'IB-107', weight: 'primary' },
        { label: 'I would rather do it myself', kind: 'goto', go: 'IB-110' },
      ],
    },

    'IB-107': {
      id: 'IB-107',
      title: 'Talking to your router',
      body: ['This takes a few seconds.'],
      actions: [{ label: 'Cancel', kind: 'goto', go: 'IB-000' }],
    },

    'IB-108': {
      id: 'IB-108',
      title: 'Checking it really saved',
      body: [
        'Some routers say "saved" without saving. I am reading the setting back to be sure.',
      ],
      actions: [{ label: 'Wait', kind: 'goto', go: 'IB-111' }],
    },

    'IB-109': {
      id: 'IB-109',
      title: 'I could not change it automatically',
      tone: 'warn',
      body: [
        "I could not make the change on your router. That is on me, not on you.",
        'I will show you exactly where to tap instead. It is one setting and about a minute.',
      ],
      actions: [{ label: 'Show me', kind: 'goto', go: 'IB-110', weight: 'primary' }],
    },

    /**
     * ADR-001 (accepted 2026-08-24) rewrote this screen.
     *
     * It used to send the customer to the DHCP/LAN settings, which points every
     * DEVICE at the box. That is the change that made a dead box a whole-house
     * outage. We now change the router's own UPSTREAM setting instead: the router
     * keeps answering its clients and asks us. Nothing is taken away from it, so
     * when the box dies the router carries on by itself.
     *
     * The DHCP setting is deliberately LEFT ALONE. If a future edit moves this
     * screen back to DHCP, it silently reintroduces the Class A outage — that is
     * why the instruction to avoid the Wi-Fi/LAN section is a step, not a comment.
     */
    'IB-110': {
      id: 'IB-110',
      title: 'Changing it yourself',
      body: [
        'One setting, about a minute. Open your router settings page in a browser: {{gateway}}',
        'This is the setting that decides who your router asks when it looks up a website name. You are pointing it at your box.',
      ],
      steps: [
        'Find the Internet or WAN settings. Not the Wi-Fi settings.',
        'Look for DNS. Your router may call it DNS Server or Static DNS.',
        'Set the first box to {{nodeIp}}',
        'Leave the second box empty.',
        'Save.',
      ],
      actions: [
        { label: 'Open router settings', kind: 'openRouterAdmin' },
        { label: 'Done', kind: 'goto', go: 'IB-111', weight: 'primary' },
        { label: 'I cannot find that setting', kind: 'goto', go: 'IB-991' },
      ],
    },

    'IB-111': {
      id: 'IB-111',
      title: 'One more thing on your router',
      tone: 'warn',
      body: [
        'Your router is advertising a newer type of internet address that it cannot actually reach.',
        'Phones prefer that newer type. They try it, it fails, and then the phone decides your Wi-Fi is broken and drops off it.',
        'This must be switched off, or your phones will keep losing the Wi-Fi.',
      ],
      steps: [
        'Open your router settings: {{gateway}}',
        'Find the setting called IPv6.',
        'Set it to Off or Disabled.',
        'Save.',
      ],
      actions: [
        { label: 'Done', kind: 'goto', go: 'IB-112', weight: 'primary' },
        { label: 'I will do it later', kind: 'goto', go: 'IB-112' },
      ],
    },

    'IB-112': {
      id: 'IB-112',
      title: 'You are protected',
      tone: 'good',
      body: [
        'Done. Your router now asks your box about website names, so everything in the house is covered by the same filter.',
        'Protection starts on the lowest setting. It blocks ads and trackers and will not break anything. You can turn it up whenever you like.',
        // ADR-001 accepted that filtering is not 100%, and said in terms: do not
        // let the copy imply total coverage. This paragraph is that instruction.
        'Your router still decides when to ask. Nearly everything comes to us, but a few lookups go straight out, so the numbers you see will never be a perfect hundred percent.',
      ],
      actions: [{ label: 'Finish', kind: 'close', weight: 'primary' }],
    },

    /* ================================================================= FAULT */

    'IB-200': {
      id: 'IB-200',
      title: 'Let me check a few things',
      diagnoseOnEnter: true,
      body: ['This takes about five seconds.'],
      actions: [{ label: 'Cancel', kind: 'close' }],
    },

    'IB-201': {
      id: 'IB-201',
      title: 'This phone is not on your Wi-Fi',
      tone: 'warn',
      body: [
        'This phone is using mobile data, not your home Wi-Fi. That is why things look different from what you expect.',
        'Connect to your home Wi-Fi and I will check again.',
      ],
      actions: [
        { label: 'Open Wi-Fi settings', kind: 'openWifiSettings', weight: 'primary' },
        { label: 'Check again', kind: 'rerunDiagnosis' },
      ],
    },

    'IB-203': {
      id: 'IB-203',
      title: 'Your internet is down, and it is not your box',
      tone: 'bad',
      body: [
        'Your internet connection itself is down. I checked, and your Gate^Flame box is not the cause. The box only decides which websites are allowed. It cannot stop your line from working.',
        'This is your router or your internet provider.',
      ],
      steps: [
        'Unplug your router, wait ten seconds, plug it back in.',
        'Give it two minutes to start up.',
        'If it is still down, check whether your provider has a fault in your area.',
      ],
      actions: [{ label: 'Check again', kind: 'rerunDiagnosis', weight: 'primary' }],
    },

    /**
     * ADR-001 turned this screen from an emergency into a notice.
     *
     * Under the old DHCP model a dead box was a whole-house outage, so this screen
     * shouted and offered IB-205, a hand-revert walkthrough. As an upstream we take
     * nothing away from the router, so it keeps resolving on its own the moment we
     * stop answering. What the customer loses is the filtering, not the internet.
     *
     * NOTE this screen is now the UNCOMMON branch. S2 needs name lookups to be
     * failing AND the box unreachable — i.e. the box is off and the router did not
     * fall back. The ordinary "box is off" case now lands on S5/IB-209, because
     * lookups keep working. Both were updated together; keep them consistent.
     */
    'IB-204': {
      id: 'IB-204',
      title: 'Your box is off, and websites are not loading',
      tone: 'warn',
      body: [
        'Your Gate^Flame box is not answering. Normally your router would carry on looking up website names by itself, but right now it is not doing that either.',
        'Getting the box back on is the quickest fix. Nothing is being filtered while it is off.',
      ],
      steps: [
        "Check the box's power light is on.",
        'Push the power adapter all the way in at both ends.',
        'Check the network cable is still in the router.',
        'If there was a power cut, give the box two minutes after the power comes back.',
      ],
      actions: [
        { label: 'The box is on now', kind: 'rerunDiagnosis', weight: 'primary' },
        { label: 'It will not switch on', kind: 'goto', go: 'IB-990' },
      ],
    },

    'IB-206': {
      id: 'IB-206',
      title: 'Your box is busy fixing itself',
      tone: 'warn',
      body: [
        'Your box is on, but the part that looks up website names has stopped.',
        'The box has already noticed and is restarting that part by itself. This usually takes under two minutes.',
        'Give it a moment, then check again.',
      ],
      actions: [
        { label: 'Check again', kind: 'rerunDiagnosis', weight: 'primary' },
        { label: 'It has been more than five minutes', kind: 'goto', go: 'IB-207' },
      ],
    },

    'IB-207': {
      id: 'IB-207',
      title: 'Restart it now',
      body: [
        'I will restart the name lookup service on your box.',
        'Your internet may pause for a few seconds while it comes back.',
      ],
      actions: [
        { label: 'Restart it', kind: 'restartResolver', go: 'IB-200', weight: 'primary' },
        { label: 'No, leave it', kind: 'goto', go: 'IB-000' },
      ],
    },

    'IB-208': {
      id: 'IB-208',
      title: 'This phone is going around your box',
      tone: 'bad',
      body: [
        'Your box is working, but this phone is not using it. So this phone is not protected, and it may keep dropping off the Wi-Fi.',
        'This happens when your router hands out a newer type of internet address that it cannot actually reach. Phones prefer that type and get stuck on it.',
        'The fix is on your router, and it only needs doing once.',
      ],
      steps: [
        'Open your router settings: {{gateway}}',
        'Find the setting called IPv6.',
        'Set it to Off or Disabled.',
        'Save.',
        "Turn this phone's Wi-Fi off and on.",
      ],
      actions: [
        { label: 'Open router settings', kind: 'openRouterAdmin' },
        { label: 'Done, check again', kind: 'rerunDiagnosis', weight: 'primary' },
        { label: 'I cannot find that setting', kind: 'goto', go: 'IB-991' },
      ],
    },

    'IB-209': {
      id: 'IB-209',
      title: 'Your internet is fine, I just cannot see your box',
      tone: 'warn',
      body: [
        'Your internet is working normally. I just cannot talk to your box from this phone, so I cannot show you its status.',
        'Usually this is because this phone is on a guest network or a different Wi-Fi, or because the box got a new address after a restart. It can also mean the box itself is off.',
        // ADR-001: do not reassure here. Since the router falls back on its own,
        // "internet fine, box unseen" is now the ORDINARY shape of a box that is
        // switched off — the old copy called that "probably still working".
        'I cannot tell from here which it is. If the box is off, nothing is being filtered right now, even though your internet is fine.',
      ],
      actions: [
        { label: 'Check again', kind: 'rerunDiagnosis', weight: 'primary' },
        { label: 'Find my box again', kind: 'startPairing', go: 'IB-200' },
      ],
    },

    'IB-210': {
      id: 'IB-210',
      title: 'Everything looks healthy',
      tone: 'good',
      renderNetcheck: true,
      body: [
        'I checked everything and it all looks right. Your internet is working, your box is answering, and your website name lookups are going through it.',
        'If one particular website is not loading, it may be blocked on purpose.',
      ],
      actions: [
        { label: 'A website is blocked', kind: 'goto', go: 'IB-301', weight: 'primary' },
        { label: 'Show me the details', kind: 'goto', go: 'IB-401' },
        { label: 'Something else is wrong', kind: 'goto', go: 'IB-992' },
      ],
    },

    /* ======================================================= BLOCKED WEBSITE */

    'IB-301': {
      id: 'IB-301',
      title: 'Which website?',
      body: ['Type the address of the website that is not working.'],
      actions: [{ label: 'Check it', kind: 'goto', go: 'IB-302', weight: 'primary' }],
    },

    'IB-302': {
      id: 'IB-302',
      title: 'Checking whether we blocked it',
      actions: [{ label: 'Cancel', kind: 'goto', go: 'IB-000' }],
    },

    'IB-303': {
      id: 'IB-303',
      title: 'Yes, we blocked it',
      body: [
        'We blocked {{site}}. It is on the {{list}} list, which is part of your {{category}} setting.',
        'You have three choices.',
      ],
      actions: [
        { label: 'Always allow this website', kind: 'allowSite', go: 'IB-305', weight: 'primary' },
        { label: 'Turn off {{category}}', kind: 'goto', go: 'IB-304' },
        { label: 'Leave it blocked', kind: 'goto', go: 'IB-000' },
      ],
    },

    'IB-304': {
      id: 'IB-304',
      title: 'Turn off {{category}}?',
      tone: 'warn',
      body: [
        'This unblocks {{site}} and everything else in {{category}}.',
        '{{categoryBreaks}}',
      ],
      actions: [
        { label: 'Turn it off', kind: 'disableCategory', go: 'IB-305', weight: 'danger' },
        { label: 'Cancel', kind: 'back' },
      ],
    },

    'IB-305': {
      id: 'IB-305',
      title: 'Changed - give it a minute',
      tone: 'good',
      body: [
        'Your box is updating its lists now. This takes up to a minute.',
        'If the website still does not load after that, close your browser completely and open it again.',
      ],
      actions: [{ label: 'Done', kind: 'close', weight: 'primary' }],
    },

    'IB-306': {
      id: 'IB-306',
      title: 'It is not us',
      body: [
        'We are not blocking {{site}}. Your box is letting it through.',
        'The website may be down, or blocked somewhere else - your browser, this phone\'s own settings, or the website blocking your country.',
        'If you want to be completely sure it is not us, pause protection for five minutes and try again.',
      ],
      actions: [
        { label: 'Pause for 5 minutes', kind: 'pause', arg: 5, go: 'IB-502', weight: 'primary' },
        { label: 'OK', kind: 'close' },
      ],
    },

    /* ============================================================ PROTECTION */

    'IB-401': {
      id: 'IB-401',
      title: 'Your protection',
      renderNetcheck: true,
      diagnoseOnEnter: false,
      body: [
        'Here is everything I can check, most important first. Fix them in this order - each one can hide the next.',
      ],
      actions: [{ label: 'Done', kind: 'close', weight: 'primary' }],
    },

    /* ================================================================= PAUSE */

    'IB-501': {
      id: 'IB-501',
      title: 'Pause protection',
      tone: 'warn',
      body: [
        'While paused, nothing is blocked. Ads come back and no website is filtered.',
        'Your internet keeps working normally the whole time.',
        'Your settings are remembered. Nothing is lost when protection comes back on.',
      ],
      actions: [
        { label: '5 minutes', kind: 'pause', arg: 5, go: 'IB-502', weight: 'primary' },
        { label: '1 hour', kind: 'pause', arg: 60, go: 'IB-502' },
        { label: 'Until I turn it back on', kind: 'pause', arg: 'indefinite', go: 'IB-502', weight: 'danger' },
        { label: 'Cancel', kind: 'back' },
      ],
    },

    'IB-502': {
      id: 'IB-502',
      title: 'Protection is OFF',
      tone: 'bad',
      body: [
        'Nothing is being blocked right now.',
        'It comes back on by itself at {{time}}.',
      ],
      actions: [
        { label: 'Turn protection back on now', kind: 'resume', go: 'IB-000', weight: 'primary' },
        { label: 'Leave it off', kind: 'close' },
      ],
    },

    /* ================================================== MOVE / REPLACE / REMOVE */

    'IB-601': {
      id: 'IB-601',
      title: 'What are you doing?',
      actions: [
        { label: 'Moving it to another spot', kind: 'goto', go: 'IB-602' },
        { label: 'I got a new router', kind: 'goto', go: 'IB-603' },
        { label: 'I got a new phone', kind: 'goto', go: 'IB-604' },
        { label: 'Removing it for good', kind: 'goto', go: 'IB-605', weight: 'danger' },
      ],
    },

    'IB-602': {
      id: 'IB-602',
      title: 'Moving the box',
      body: [
        'Unplug it, move it, plug it back in. Same router, any spare port.',
        'Nothing else to do. I will find it again by myself.',
        // ADR-001: this used to warn of a one-to-two minute internet outage. There
        // is no outage — the router keeps resolving while we are away.
        'Your internet keeps working the whole time. Filtering stops until the box is back on.',
      ],
      actions: [{ label: 'Got it', kind: 'close', weight: 'primary' }],
    },

    'IB-603': {
      id: 'IB-603',
      title: 'New router',
      body: [
        'A new router does not know about your box yet, so that one setting has to be changed again.',
        'Plug the box into the new router first.',
      ],
      actions: [
        { label: 'Set up with my new router', kind: 'goto', go: 'IB-106', weight: 'primary' },
        { label: 'Later', kind: 'close' },
      ],
    },

    'IB-604': {
      id: 'IB-604',
      title: 'New phone',
      body: [
        "Install the app on the new phone, then read the code off the box's screen to pair it.",
        'Your old phone stays paired until you remove it.',
      ],
      actions: [
        { label: 'Remove my old phone', kind: 'goto', go: 'IB-000' },
        { label: 'Done', kind: 'close', weight: 'primary' },
      ],
    },

    /**
     * ADR-001 removed this screen's warning, and with it the reason it was scary.
     *
     * It used to say that unplugging without reverting stops websites loading for
     * the whole house. That was true of the DHCP model and is not true of ours —
     * the router only ever asked us, it never stopped answering its own clients.
     *
     * Reverting is now hygiene, not rescue: it stops the router keeping a dead
     * address configured. Offered, not demanded, and "just unplug it" is a
     * first-class answer rather than a way to break your house.
     */
    'IB-605': {
      id: 'IB-605',
      title: 'Removing your box',
      body: [
        'You can unplug it whenever you like. Your internet will keep working — your router goes straight back to looking up website names by itself.',
        'Nothing on your network will be filtered after that.',
        'If you like, I can clear your box out of your router settings first, so nothing is left pointing at a box that is gone.',
      ],
      actions: [
        { label: 'Tidy up my router first', kind: 'revertRouterAndRemove', go: 'IB-606', weight: 'primary' },
        { label: 'I will just unplug it', kind: 'close' },
        { label: 'Cancel', kind: 'back' },
      ],
    },

    'IB-606': {
      id: 'IB-606',
      title: 'Done - safe to unplug',
      tone: 'good',
      body: [
        'Your router is back the way it was. You can unplug the box now.',
        'Nothing on your network is filtered any more.',
      ],
      actions: [{ label: 'Finish', kind: 'close', weight: 'primary' }],
    },

    /* ============================================================= FALLBACKS */

    'IB-990': {
      id: 'IB-990',
      title: 'The box will not switch on',
      tone: 'bad',
      body: [
        'The box is not powering up. That is a hardware fault, not something you can fix, and not something you did.',
        'Send us a message and we will sort out a replacement: {{contact}}',
      ],
      actions: [
        { label: 'Contact us', kind: 'contactSupport', weight: 'primary' },
        { label: 'Back', kind: 'back' },
      ],
    },

    'IB-991': {
      id: 'IB-991',
      title: 'Routers hide this in different places',
      body: [
        'I do not know your exact router model, and I will not guess at settings on your router.',
        'Take a photo of your router settings page and send it to us: {{contact}}',
        'We will tell you exactly where to tap, and add your router so the next person does not have to ask.',
      ],
      actions: [
        { label: 'Contact us', kind: 'contactSupport', weight: 'primary' },
        { label: 'Back', kind: 'back' },
      ],
    },

    'IB-992': {
      id: 'IB-992',
      title: 'Tell us what is happening',
      body: [
        'Everything I can check looks right, so I do not want to guess.',
        'Send us a message with what you were doing and what you expected to happen: {{contact}}',
      ],
      actions: [
        { label: 'Contact us', kind: 'contactSupport', weight: 'primary' },
        { label: 'Back', kind: 'back' },
      ],
    },
  },
};
