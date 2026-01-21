"""
Prompt Builder for AI Image Generation

This module provides a sophisticated prompt architecture for generating
coffee-themed images based on profile names and tags.

The system combines:
- Core base prompts with safety constraints
- Tag-specific influences (colors, elements, compositions, moods)
- Style modifiers that respect user's art style choice
- Random sub-options for variety across invocations
- Profile name emphasis techniques
"""

import random
from typing import List, Dict, Optional, Set
from dataclasses import dataclass, field


@dataclass
class TagInfluence:
    """Defines visual influences for a specific tag."""
    colors: List[str] = field(default_factory=list)
    elements: List[str] = field(default_factory=list)
    compositions: List[str] = field(default_factory=list)
    moods: List[str] = field(default_factory=list)
    textures: List[str] = field(default_factory=list)


# =============================================================================
# TAG INFLUENCE MAPPINGS
# =============================================================================
# Extensible structure - add new tags by adding entries to these dictionaries

# Roast Level Influences
ROAST_INFLUENCES: Dict[str, TagInfluence] = {
    "light": TagInfluence(
        colors=["pale gold", "honey amber", "soft cream", "light caramel", "champagne"],
        elements=["delicate wisps", "ethereal light rays", "morning dew", "translucent layers"],
        compositions=["airy open space", "floating elements", "ascending movement"],
        moods=["bright", "fresh", "delicate", "awakening"],
        textures=["smooth gradients", "soft edges", "gossamer"]
    ),
    "medium": TagInfluence(
        colors=["warm bronze", "rich amber", "toasted copper", "chestnut brown", "maple"],
        elements=["balanced forms", "interlocking shapes", "flowing curves", "harmonious patterns"],
        compositions=["centered balance", "symmetrical arrangement", "golden ratio"],
        moods=["balanced", "comforting", "approachable", "harmonious"],
        textures=["velvet", "brushed metal", "polished wood grain"]
    ),
    "dark": TagInfluence(
        colors=["deep espresso", "charcoal black", "dark chocolate", "midnight brown", "obsidian"],
        elements=["bold shadows", "dramatic contrasts", "dense forms", "powerful shapes"],
        compositions=["heavy bottom weight", "grounded elements", "strong verticals"],
        moods=["intense", "bold", "mysterious", "commanding"],
        textures=["rough hewn", "carbon fiber", "volcanic rock"]
    ),
}

# Flavor Note Influences
FLAVOR_INFLUENCES: Dict[str, TagInfluence] = {
    "fruity": TagInfluence(
        colors=["berry purple", "citrus orange", "apple red", "tropical yellow", "peach coral"],
        elements=["organic spheres", "juice droplets", "curved petals", "fruit silhouettes"],
        compositions=["scattered arrangement", "bursting from center", "playful asymmetry"],
        moods=["vibrant", "joyful", "lively", "refreshing"],
        textures=["glossy", "juicy sheen", "organic surfaces"]
    ),
    "chocolate": TagInfluence(
        colors=["cocoa brown", "dark truffle", "milk chocolate", "mocha cream", "ganache"],
        elements=["swirling ribbons", "melting forms", "layered depths", "rich pools"],
        compositions=["flowing downward", "pooling at base", "cascading layers"],
        moods=["indulgent", "luxurious", "comforting", "rich"],
        textures=["molten", "silky smooth", "velvety"]
    ),
    "nutty": TagInfluence(
        colors=["hazelnut tan", "almond beige", "walnut brown", "peanut gold", "pecan amber"],
        elements=["organic shapes", "shell curves", "natural fragments", "seed forms"],
        compositions=["clustered groups", "natural scatter", "grounded arrangement"],
        moods=["earthy", "warm", "rustic", "wholesome"],
        textures=["rough bark", "shell patterns", "granular"]
    ),
    "floral": TagInfluence(
        colors=["lavender purple", "rose pink", "jasmine white", "hibiscus red", "chamomile yellow"],
        elements=["petal shapes", "botanical curves", "stamen details", "garden silhouettes"],
        compositions=["radiating from center", "upward growth", "organic sprawl"],
        moods=["elegant", "delicate", "romantic", "fragrant"],
        textures=["soft petals", "dewy surfaces", "silk"]
    ),
    "spicy": TagInfluence(
        colors=["cinnamon red", "ginger orange", "cardamom green", "pepper black", "clove brown"],
        elements=["sharp angles", "flame shapes", "dynamic spirals", "pointed forms"],
        compositions=["explosive center", "radiating energy", "dynamic movement"],
        moods=["energetic", "warm", "exotic", "intense"],
        textures=["crystalline", "rough ground spice", "heat shimmer"]
    ),
    "citrus": TagInfluence(
        colors=["lemon yellow", "lime green", "orange zest", "grapefruit pink", "tangerine"],
        elements=["segment curves", "zest sprays", "droplet splashes", "wedge shapes"],
        compositions=["bright center", "outward splash", "fresh arrangement"],
        moods=["zesty", "bright", "invigorating", "clean"],
        textures=["bumpy rind", "translucent flesh", "sparkling"]
    ),
    "caramel": TagInfluence(
        colors=["golden caramel", "butterscotch", "toffee brown", "burnt sugar", "honey amber"],
        elements=["dripping forms", "stretched ribbons", "pooling shapes", "crystalline edges"],
        compositions=["flowing downward", "sticky connections", "warm pools"],
        moods=["sweet", "indulgent", "warm", "inviting"],
        textures=["glossy", "sticky", "crystallized edges"]
    ),
    "berry": TagInfluence(
        colors=["blueberry indigo", "raspberry pink", "blackberry purple", "strawberry red", "cranberry"],
        elements=["clustered spheres", "juice splashes", "organic clusters", "seed patterns"],
        compositions=["grouped clusters", "scattered arrangement", "overflowing"],
        moods=["sweet", "tart", "vibrant", "fresh"],
        textures=["glossy skin", "juice sheen", "soft flesh"]
    ),
    "earthy": TagInfluence(
        colors=["soil brown", "moss green", "clay terracotta", "stone grey", "forest floor"],
        elements=["root shapes", "geological layers", "organic decay", "mineral forms"],
        compositions=["grounded base", "layered strata", "deep foundation"],
        moods=["grounded", "primal", "natural", "ancient"],
        textures=["rough earth", "weathered stone", "organic matter"]
    ),
    "honey": TagInfluence(
        colors=["golden honey", "amber nectar", "honeycomb gold", "bee pollen yellow"],
        elements=["hexagonal patterns", "dripping forms", "flowing streams", "cellular grids"],
        compositions=["structured patterns", "flowing movement", "organic geometry"],
        moods=["sweet", "natural", "golden", "precious"],
        textures=["viscous", "translucent", "crystalline"]
    ),
}

# Profile Characteristic Influences
CHARACTERISTIC_INFLUENCES: Dict[str, TagInfluence] = {
    "acidity": TagInfluence(
        colors=["electric yellow", "sharp green", "citrus orange", "bright white"],
        elements=["lightning bolts", "sharp edges", "angular forms", "crystalline structures"],
        compositions=["pointed focus", "high contrast", "dynamic angles"],
        moods=["bright", "sharp", "lively", "electric"],
        textures=["crisp edges", "faceted", "sparkling"]
    ),
    "body": TagInfluence(
        colors=["deep burgundy", "rich mahogany", "dense brown", "substantial ochre"],
        elements=["weighty forms", "solid masses", "grounded shapes", "dense layers"],
        compositions=["bottom-heavy", "substantial center", "anchored"],
        moods=["full", "substantial", "enveloping", "rich"],
        textures=["thick", "viscous", "substantial"]
    ),
    "bloom": TagInfluence(
        colors=["effervescent cream", "bubble white", "foam beige", "rising tan"],
        elements=["expanding circles", "rising bubbles", "blooming forms", "opening shapes"],
        compositions=["upward expansion", "opening outward", "ascending movement"],
        moods=["alive", "awakening", "expanding", "fresh"],
        textures=["foamy", "airy", "effervescent"]
    ),
    "sweetness": TagInfluence(
        colors=["candy pink", "sugar white", "cotton candy", "soft peach"],
        elements=["soft curves", "rounded forms", "gentle waves", "plush shapes"],
        compositions=["soft focus", "gentle arrangement", "welcoming openness"],
        moods=["sweet", "gentle", "pleasant", "inviting"],
        textures=["soft", "pillowy", "smooth"]
    ),
    "complexity": TagInfluence(
        colors=["layered gradients", "shifting hues", "iridescent", "multichromatic"],
        elements=["interwoven patterns", "nested shapes", "fractal elements", "layered depths"],
        compositions=["multiple focal points", "depth layers", "intricate arrangement"],
        moods=["sophisticated", "intriguing", "multifaceted", "deep"],
        textures=["layered", "multidimensional", "intricate"]
    ),
    "clarity": TagInfluence(
        colors=["crystal clear", "pure white", "glass blue", "transparent"],
        elements=["clean lines", "defined edges", "simple forms", "precise geometry"],
        compositions=["uncluttered space", "clear hierarchy", "minimal arrangement"],
        moods=["pure", "clean", "transparent", "precise"],
        textures=["glass-like", "polished", "pristine"]
    ),
}

# Processing Method Influences
PROCESSING_INFLUENCES: Dict[str, TagInfluence] = {
    "washed": TagInfluence(
        colors=["clean blue", "pure white", "crystal clear", "fresh green"],
        elements=["water droplets", "clean lines", "flowing streams", "pristine forms"],
        compositions=["clean arrangement", "clear separation", "defined boundaries"],
        moods=["clean", "pure", "refined", "precise"],
        textures=["polished", "smooth", "wet sheen"]
    ),
    "natural": TagInfluence(
        colors=["sun-dried amber", "fruit red", "wild berry", "organic brown"],
        elements=["sun rays", "dried textures", "fruit forms", "organic shapes"],
        compositions=["natural scatter", "sun-touched", "organic flow"],
        moods=["wild", "fruity", "natural", "sun-kissed"],
        textures=["dried", "sun-baked", "natural grain"]
    ),
    "honey": TagInfluence(
        colors=["sticky amber", "mucilage gold", "sweet brown", "nectar yellow"],
        elements=["sticky threads", "dripping forms", "viscous flows", "sweet pools"],
        compositions=["connected elements", "flowing transitions", "sticky bonds"],
        moods=["sweet", "complex", "sticky", "layered"],
        textures=["mucilaginous", "sticky", "semi-dried"]
    ),
}

# Origin Influences
ORIGIN_INFLUENCES: Dict[str, TagInfluence] = {
    "ethiopian": TagInfluence(
        colors=["wild berry purple", "jasmine white", "highland green", "ancient gold"],
        elements=["coffee cherry shapes", "ancient patterns", "wild flora", "heritage symbols"],
        compositions=["birthplace reverence", "wild natural arrangement", "ancient geometry"],
        moods=["ancestral", "wild", "floral", "exotic"],
        textures=["ancient stone", "wild growth", "heritage"]
    ),
    "colombian": TagInfluence(
        colors=["emerald green", "mountain blue", "coffee cherry red", "andean gold"],
        elements=["mountain peaks", "terraced hillsides", "lush vegetation", "altitude symbols"],
        compositions=["ascending layers", "mountain silhouettes", "terraced arrangement"],
        moods=["balanced", "approachable", "classic", "reliable"],
        textures=["mountain mist", "fertile soil", "lush green"]
    ),
    "brazilian": TagInfluence(
        colors=["sunset orange", "nutty brown", "chocolate", "tropical yellow"],
        elements=["sun shapes", "vast horizons", "bold forms", "tropical elements"],
        compositions=["expansive arrangement", "bold presence", "substantial forms"],
        moods=["bold", "nutty", "substantial", "warm"],
        textures=["sun-warmed", "substantial", "smooth"]
    ),
    "kenyan": TagInfluence(
        colors=["bright tomato red", "citrus yellow", "black currant purple", "savanna gold"],
        elements=["bold punctuation", "bright splashes", "African patterns", "wildlife silhouettes"],
        compositions=["bright focal points", "bold contrast", "dynamic arrangement"],
        moods=["bright", "bold", "complex", "striking"],
        textures=["juicy", "vibrant", "bold"]
    ),
    "guatemalan": TagInfluence(
        colors=["volcanic grey", "chocolate brown", "spice red", "ancient jade"],
        elements=["volcanic forms", "ancient motifs", "smoke wisps", "temple geometry"],
        compositions=["dramatic depth", "ancient proportion", "smoky layers"],
        moods=["complex", "smoky", "ancient", "dramatic"],
        textures=["volcanic", "ancient stone", "smoky"]
    ),
    "indonesian": TagInfluence(
        colors=["earthy brown", "spice orange", "forest green", "island blue"],
        elements=["island shapes", "spice forms", "tropical foliage", "monsoon patterns"],
        compositions=["layered depth", "island clusters", "tropical arrangement"],
        moods=["earthy", "exotic", "full-bodied", "mysterious"],
        textures=["earthy", "tropical", "monsoon-touched"]
    ),
}

# Technique/Style Influences
TECHNIQUE_INFLUENCES: Dict[str, TagInfluence] = {
    "espresso": TagInfluence(
        colors=["crema gold", "espresso black", "tiger stripe amber", "pressure bronze"],
        elements=["pressure gauges", "extraction streams", "crema swirls", "portafilter shapes"],
        compositions=["concentrated center", "downward flow", "pressure focus"],
        moods=["intense", "concentrated", "precise", "powerful"],
        textures=["crema foam", "oily sheen", "dense liquid"]
    ),
    "pour-over": TagInfluence(
        colors=["clarity amber", "bloom cream", "filter paper white", "gentle brown"],
        elements=["spiral patterns", "blooming circles", "gentle streams", "cone shapes"],
        compositions=["centered spiral", "gentle descent", "meditative arrangement"],
        moods=["meditative", "precise", "patient", "delicate"],
        textures=["paper texture", "gentle flow", "clear liquid"]
    ),
    "cold brew": TagInfluence(
        colors=["ice blue", "cold black", "refreshing amber", "frost white"],
        elements=["ice crystals", "slow drips", "cold condensation", "time symbols"],
        compositions=["vertical descent", "patient layers", "cool arrangement"],
        moods=["refreshing", "patient", "smooth", "cool"],
        textures=["icy", "smooth", "condensation"]
    ),
    "modern": TagInfluence(
        colors=["minimalist white", "tech silver", "innovation blue", "clean grey"],
        elements=["geometric precision", "clean lines", "modern curves", "tech elements"],
        compositions=["grid-based", "precise spacing", "contemporary balance"],
        moods=["innovative", "clean", "forward-thinking", "precise"],
        textures=["polished metal", "matte surfaces", "precision edges"]
    ),
    "traditional": TagInfluence(
        colors=["heritage brown", "antique gold", "classic cream", "warm sepia"],
        elements=["vintage motifs", "classic shapes", "heritage patterns", "time-worn forms"],
        compositions=["classic proportion", "time-honored arrangement", "balanced tradition"],
        moods=["nostalgic", "classic", "timeless", "warm"],
        textures=["aged patina", "worn wood", "classic materials"]
    ),
}


# =============================================================================
# STYLE MODIFIERS
# These enhance the base style chosen by the user
# =============================================================================

STYLE_MODIFIERS: Dict[str, Dict[str, List[str]]] = {
    "abstract": {
        "techniques": ["non-representational forms", "emotional color fields", "gestural marks", "pure abstraction"],
        "artists": ["inspired by Kandinsky", "Rothko-esque color depth", "Pollock energy", "Mondrian geometry"],
        "approaches": ["deconstructed reality", "essence over appearance", "emotional interpretation", "pure visual rhythm"],
    },
    "minimalist": {
        "techniques": ["negative space emphasis", "essential forms only", "reductive approach", "stark simplicity"],
        "artists": ["Malevich inspired", "Agnes Martin subtlety", "Donald Judd precision"],
        "approaches": ["less is more", "purposeful emptiness", "quiet power", "essential expression"],
    },
    "pixel-art": {
        "techniques": ["deliberate pixelation", "limited color palette", "retro game aesthetic", "8-bit charm"],
        "artists": ["classic arcade style", "indie game art", "demoscene influence"],
        "approaches": ["nostalgic digital", "precise pixel placement", "retro-futurism", "digital mosaic"],
    },
    "watercolor": {
        "techniques": ["wet-on-wet bleeding", "organic color spread", "paper texture visible", "transparent layers"],
        "artists": ["Turner atmospheric", "Sargent fluidity", "Winslow Homer naturalism"],
        "approaches": ["controlled accidents", "luminous transparency", "soft edge bleeding", "natural flow"],
    },
    "modern": {
        "techniques": ["contemporary digital art", "clean vector lines", "bold graphic design", "modern illustration"],
        "artists": ["contemporary design", "modern poster art", "digital illustration masters"],
        "approaches": ["fresh perspective", "current aesthetics", "bold simplification", "graphic impact"],
    },
    "vintage": {
        "techniques": ["aged color palette", "retro printing effects", "nostalgic grain", "period-accurate style"],
        "artists": ["art deco influence", "mid-century modern", "vintage poster art"],
        "approaches": ["timeless quality", "nostalgic warmth", "classic craftsmanship", "heritage aesthetic"],
    },
}


# =============================================================================
# PROFILE NAME EMPHASIS TECHNIQUES
# Ways to make the profile name concept central to the image
# =============================================================================

PROFILE_EMPHASIS_TECHNIQUES: List[str] = [
    "as the dominant central subject",
    "expressed through symbolic visual metaphor",
    "manifested as the core visual element",
    "represented through evocative imagery",
    "interpreted as an abstract visual concept",
    "translated into powerful visual symbolism",
    "embodied in the composition's focal point",
    "expressed through color and form",
    "as the driving visual narrative",
    "captured in abstract essence",
]


# =============================================================================
# CORE PROMPT ELEMENTS
# =============================================================================

CORE_SAFETY_CONSTRAINTS: List[str] = [
    "No text, words, letters, or numbers.",
    "No realistic human faces.",
    "Abstract artistic interpretation.",
]

CORE_COFFEE_THEMES: List[str] = [
    "coffee and espresso essence",
    "brewing artistry",
    "coffee culture aesthetic",
    "espresso craft",
    "coffee bean origins",
    "the ritual of coffee",
    "coffee as art form",
]

COMPOSITION_ENHANCERS: List[str] = [
    "visually striking composition",
    "dynamic visual balance",
    "harmonious arrangement",
    "compelling focal point",
    "artistic visual flow",
    "engaging visual hierarchy",
    "powerful visual presence",
]


# =============================================================================
# PROMPT BUILDER CLASS
# =============================================================================

class PromptBuilder:
    """
    Builds varied, tag-influenced prompts for coffee-themed image generation.
    
    Each invocation produces different results through random selection
    of sub-options while maintaining relevance to the profile and tags.
    """
    
    def __init__(self, profile_name: str, style: str, tags: List[str]):
        self.profile_name = profile_name
        self.style = style.lower()
        self.tags = [tag.lower().strip() for tag in tags]
        self.collected_influences: List[TagInfluence] = []
        
    def _collect_influences(self) -> None:
        """Gather all relevant influences based on tags."""
        self.collected_influences = []
        
        for tag in self.tags:
            # Check each influence dictionary
            for influence_dict in [
                ROAST_INFLUENCES,
                FLAVOR_INFLUENCES,
                CHARACTERISTIC_INFLUENCES,
                PROCESSING_INFLUENCES,
                ORIGIN_INFLUENCES,
                TECHNIQUE_INFLUENCES,
            ]:
                # Check for exact match or partial match
                for key, influence in influence_dict.items():
                    if key in tag or tag in key:
                        self.collected_influences.append(influence)
                        break
        
        # If no influences found, add some defaults
        if not self.collected_influences:
            self.collected_influences.append(FLAVOR_INFLUENCES.get("caramel", TagInfluence()))
            self.collected_influences.append(TECHNIQUE_INFLUENCES.get("espresso", TagInfluence()))
    
    def _random_select(self, items: List[str], count: int = 1) -> List[str]:
        """Randomly select items from a list."""
        if not items:
            return []
        count = min(count, len(items))
        return random.sample(items, count)
    
    def _gather_from_influences(self, attribute: str, count: int = 2) -> List[str]:
        """Gather random items from a specific attribute across all influences."""
        all_items: Set[str] = set()
        for influence in self.collected_influences:
            items = getattr(influence, attribute, [])
            all_items.update(items)
        return self._random_select(list(all_items), count)
    
    def _get_style_modifiers(self) -> List[str]:
        """Get random style modifiers for the chosen art style."""
        style_data = STYLE_MODIFIERS.get(self.style, STYLE_MODIFIERS["abstract"])
        modifiers = []
        
        for category, options in style_data.items():
            selected = self._random_select(options, 1)
            modifiers.extend(selected)
        
        return modifiers
    
    def build(self) -> str:
        """
        Build the complete prompt with randomized elements.
        
        Returns:
            A fully constructed prompt string optimized for image generation.
        """
        self._collect_influences()
        
        # Gather randomized elements from influences
        colors = self._gather_from_influences("colors", 2)
        elements = self._gather_from_influences("elements", 2)
        compositions = self._gather_from_influences("compositions", 1)
        moods = self._gather_from_influences("moods", 2)
        textures = self._gather_from_influences("textures", 1)
        
        # Get style modifiers
        style_modifiers = self._get_style_modifiers()
        
        # Random selections from core elements
        coffee_theme = self._random_select(CORE_COFFEE_THEMES, 1)[0]
        composition_enhancer = self._random_select(COMPOSITION_ENHANCERS, 1)[0]
        profile_emphasis = self._random_select(PROFILE_EMPHASIS_TECHNIQUES, 1)[0]
        
        # Build the prompt sections
        prompt_parts = []
        
        # 1. Profile name as central concept
        prompt_parts.append(
            f'"{self.profile_name}" {profile_emphasis}'
        )
        
        # 2. Art style with modifiers
        prompt_parts.append(
            f"{self.style} art style, {', '.join(style_modifiers)}"
        )
        
        # 3. Color palette from influences
        if colors:
            prompt_parts.append(f"color palette featuring {', '.join(colors)}")
        
        # 4. Visual elements from influences
        if elements:
            prompt_parts.append(f"incorporating {', '.join(elements)}")
        
        # 5. Mood and atmosphere
        if moods:
            prompt_parts.append(f"{', '.join(moods)} atmosphere")
        
        # 6. Composition guidance
        if compositions:
            prompt_parts.append(compositions[0])
        prompt_parts.append(composition_enhancer)
        
        # 7. Texture hints
        if textures:
            prompt_parts.append(f"{textures[0]} textures")
        
        # 8. Coffee theme connection
        prompt_parts.append(f"evoking {coffee_theme}")
        
        # 9. Format requirement
        prompt_parts.append("square format")
        
        # 10. Safety constraints
        prompt_parts.extend(CORE_SAFETY_CONSTRAINTS)
        
        # Combine all parts
        full_prompt = ". ".join(prompt_parts)
        
        return full_prompt
    
    def build_with_metadata(self) -> Dict:
        """
        Build prompt and return with metadata about what was selected.
        
        Useful for debugging and understanding prompt construction.
        """
        self._collect_influences()
        
        colors = self._gather_from_influences("colors", 2)
        elements = self._gather_from_influences("elements", 2)
        moods = self._gather_from_influences("moods", 2)
        
        prompt = self.build()
        
        return {
            "prompt": prompt,
            "metadata": {
                "profile_name": self.profile_name,
                "style": self.style,
                "tags_used": self.tags,
                "influences_found": len(self.collected_influences),
                "selected_colors": colors,
                "selected_elements": elements,
                "selected_moods": moods,
            }
        }


def build_image_prompt(profile_name: str, style: str, tags: List[str]) -> str:
    """
    Convenience function to build an image generation prompt.
    
    Args:
        profile_name: The name of the coffee profile
        style: The art style (abstract, minimalist, pixel-art, etc.)
        tags: List of tags associated with the profile
        
    Returns:
        A complete prompt string for image generation
    """
    builder = PromptBuilder(profile_name, style, tags)
    return builder.build()


def build_image_prompt_with_metadata(profile_name: str, style: str, tags: List[str]) -> Dict:
    """
    Build a prompt and return with construction metadata.
    
    Args:
        profile_name: The name of the coffee profile
        style: The art style
        tags: List of tags associated with the profile
        
    Returns:
        Dictionary with prompt and metadata
    """
    builder = PromptBuilder(profile_name, style, tags)
    return builder.build_with_metadata()
